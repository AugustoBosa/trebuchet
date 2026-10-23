import { css, drawChart, drawHeatmap, heatCell, timeAt, type ChartSpec, type HeatSpec } from './charts';
import { LABELS, RANGES } from './labels';
import { armSplitRange, axlePeak, distinctOptima, evaluate, latinHypercube, minCounterweight, paramMapper, shotsPerEval, shownValue, withSectionMass, type Env3, type Objective, type OptKey, type OptParams, type OptVar, type Struct } from './optimize';
import { BAR_MATS, sizesFor, type PartSpec } from './materials';
import type { Mode } from './structure';
import type { Reply, Request } from './optimize.worker';
import { KINDS, type Kind, type Params } from './presets';

const ENVIRONMENT: (keyof Params)[] = ['airDensity', 'dragCd', 'axleMu', 'axleRadius', 'troughMu', 'rollCrr', 'impactE']; // conditions, not design choices
const DEFAULT_ON: (keyof Params)[] = ['slingLength', 'releaseDeg'];
const STARTS = 8; // current design + 7 Latin-hypercube points

const OBJECTIVE_NAMES: Record<Objective, string> = { range: 'Alcance', efficiency: 'Eficiência', target: 'Erro até o alvo', lateral: 'Desvio lateral', robust: 'Alcance robusto' };
const label = (k: OptKey) => (k === 'pinOffset' ? 'Pino fora do centro (m)' : k === 'aimDeg' ? 'Mira (°)' : LABELS[k]);

// env3: the 3D conditions while the 3D view is on (then everything runs on the 3D solver), else undefined.
// apply3d: write optimized 3D settings (pin offset in m, aim in degrees) back to the 3D fields.
// spec: the parts' materials (part card); applyArm: set the arm's material + section and the break criterion before apply()
export function mountOptimizer(o: { kind: () => Kind; params: Params; apply: (p: Partial<Params>) => void; env3: () => Env3 | undefined; apply3d: (v: { pinOffset?: number; aimDeg?: number }) => void;
  spec: () => Record<string, PartSpec>; applyArm: (arm: PartSpec | undefined, mode: Mode) => void }) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const sweepCanvas = $<HTMLCanvasElement>('sweep');
  let pool: Worker[] = [];
  let plot: { draw: (hoverX?: number, hoverY?: number) => void; click: (x: number, y: number) => void } | undefined;

  const objective = () => $<HTMLSelectElement>('objective').value as Objective;
  const shown = (v: number) => shownValue(objective(), v);
  const unit = () => (objective() === 'efficiency' ? '%' : 'm');
  const fmt = (v: number) => `${shown(v).toFixed(objective() === 'lateral' || objective() === 'target' ? 2 : 1)} ${unit()}`;
  // 'lateral' and 'robust' only exist on the 3D solver
  const needs3d = () => (objective() === 'lateral' || objective() === 'robust') && !o.env3() && (status('Esse objetivo usa o motor 3D: ligue a "Vista 3D" primeiro.'), true);
  const status = (t: string) => ($('opt-status').textContent = t);

  function busy(on: boolean) {
    $<HTMLButtonElement>('opt-run').disabled = on;
    $<HTMLButtonElement>('sw-run').disabled = on;
    $('opt-stop').hidden = !on;
  }

  // --- fixed-beam option: long + short arm = a total the user sets; the optimizer only chooses where to cut it
  let armDirty = false; // the user typed a total: stop following the current design
  const armTotalLimits = () => [(RANGES.longArm[0] + RANGES.shortArm[0]).toFixed(2), (RANGES.longArm[1] + RANGES.shortArm[1]).toFixed(0)];
  function syncArm() {
    const sum = o.params.longArm + o.params.shortArm;
    const box = $<HTMLInputElement>('opt-arm-total');
    box.disabled = !$<HTMLInputElement>('opt-arm').checked;
    if (!armDirty) box.value = String(+sum.toFixed(3));
    const fmt = (v: number) => +v.toFixed(3);
    $('opt-arm-hint').textContent = `Atual: ${fmt(o.params.longArm)} + ${fmt(o.params.shortArm)} = ${fmt(sum)} m. Limites: ${armTotalLimits().join(' a ')} m.` +
      (o.kind() === 'walking' ? ' No walking arm, fique perto do total atual: perna, funda e soltura foram ajustadas para ele.' : '');
  }
  $('opt').addEventListener('focusin', syncArm);
  $('opt-arm').addEventListener('change', () => {
    const on = $<HTMLInputElement>('opt-arm').checked;
    $('opt-vars').querySelectorAll<HTMLInputElement>('input[value=longArm],input[value=shortArm]').forEach((i) => ((i.disabled = on), on && (i.checked = false)));
    syncArm();
  });
  $('opt-arm-total').addEventListener('input', () => (armDirty = true));
  $('opt-help-btn').addEventListener('click', () => $<HTMLDialogElement>('opt-help').showModal());

  const stopAll = () => (pool.forEach((w) => w.terminate()), (pool = []));

  // Independent jobs over a pool of workers (one per spare core); results come back in completion order.
  function runPool(reqs: Request[], on: { progress?: (r: Reply) => void; each: (r: Reply, i: number) => void; done: () => void }) {
    stopAll();
    busy(true);
    let next = 0;
    let finished = 0;
    const feed = (w: Worker) => {
      if (next >= reqs.length) return;
      const i = next++;
      w.onmessage = (e: MessageEvent<Reply>) => {
        if (e.data.type === 'progress') return on.progress?.(e.data);
        on.each(e.data, i);
        if (++finished === reqs.length) (stopAll(), busy(false), on.done());
        else feed(w);
      };
      w.postMessage(reqs[i]);
    };
    const n = Math.min(reqs.length, Math.max(1, (navigator.hardwareConcurrency || 4) - 1));
    for (let k = 0; k < n; k++) {
      const w = new Worker(new URL('./optimize.worker.ts', import.meta.url), { type: 'module' });
      w.onerror = (e) => (stopAll(), busy(false), status(`Erro no otimizador: ${e.message}`));
      pool.push(w);
      feed(w);
    }
  }
  const start = (req: Request, onDone: (r: Reply) => void) =>
    runPool([req], {
      progress: (r) => r.type === 'progress' && status(r.total ? `Varrendo… linha ${r.done}/${r.total} (${r.evals * shotsPerEval(objective())} simulações)` : ''),
      each: onDone,
      done: () => {},
    });

  $('opt-stop').addEventListener('click', () => {
    stopAll();
    busy(false);
    status('Interrompido.');
  });

  const struct = (): Struct | undefined => $<HTMLInputElement>('opt-struct').checked || $<HTMLSelectElement>('opt-mat').value
    ? { spec: { ...o.spec() }, mode: $<HTMLSelectElement>('opt-struct-mode').value as Mode, fsMin: Math.max(1, Number($<HTMLInputElement>('opt-fs').value) || 1) }
    : undefined;
  $('opt-mat').addEventListener('change', () => $<HTMLSelectElement>('opt-mat').value && ($<HTMLInputElement>('opt-struct').checked = true));

  // 'target': the distance to hit, in m (empty or ≤ 0 is refused)
  const targetM = () => (Number($<HTMLInputElement>('opt-target').value) > 0 ? Number($<HTMLInputElement>('opt-target').value) : undefined);

  // What the Otimizar and Fronteira buttons share: the free variables, the base design (with the target) and the mapper.
  // Undefined, with the reason in the status line, when something is off. forceRange: the front ignores the objective menu.
  function setup(forceRange = false) {
    const arm = $<HTMLInputElement>('opt-arm').checked;
    const armTotal = Number($<HTMLInputElement>('opt-arm-total').value);
    if (!forceRange && needs3d()) return;
    const env3 = o.env3();
    const vars: OptVar[] = [...$('opt-vars').querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value as OptVar);
    if (arm) {
      const [lo, hi] = armSplitRange(armTotal);
      if (!Number.isFinite(armTotal) || lo >= hi) return void status(`Comprimento total do braço fora do possível: use entre ${armTotalLimits().join(' e ')} m.`);
      vars.push('armSplit');
    }
    if (!vars.length) return void status('Marque ao menos uma variável.');
    const slingCap = Number($<HTMLInputElement>('opt-slingcap').value) * 1000; // kN → N; empty / 0 = no cap
    if (slingCap > 0 && env3) return void status('O teto de força na funda usa o motor plano: desligue a "Vista 3D".');
    const aim = !forceRange && objective() === 'target';
    const target = aim ? targetM() : undefined;
    if (aim && !target) return void status('Digite a distância-alvo, em metros.');
    $('opt-result').innerHTML = '';
    const base: OptParams = { ...o.params, ...(env3 ? { pinOffset: env3.pinOffset, aimDeg: env3.aimDeg } : {}), ...(target ? { target } : {}), ...(slingCap > 0 ? { slingCap } : {}) };
    return { armTotal: arm ? armTotal : undefined, env3, vars, base, map: paramMapper(base, vars, arm ? armTotal : undefined), kind: o.kind(), obj: objective() };
  }

  // "What counterweight reaches X m?" with the rest of the design as it is: one scan, no search
  $('opt-mincw').addEventListener('click', () => {
    const target = targetM();
    if (!target) return void status('Digite a distância-alvo, em metros.');
    if (!KINDS[o.kind()].fields.includes('cwMass')) return void status('Esse tipo não tem contrapeso para variar.');
    const cw = minCounterweight(o.kind(), o.params, target);
    if (cw === undefined) return void status(`Nenhum contrapeso da faixa (${RANGES.cwMass.slice(0, 2).join(' a ')} kg) chega a ${target} m com o resto do design como está. Mude o ângulo, a funda ou o braço.`);
    const got = evaluate(o.kind(), { ...o.params, cwMass: cw }, 'range');
    status(`Contrapeso mínimo para ${target} m: ${+cw.toPrecision(4)} kg (o tiro chega a ${got.toFixed(1)} m), com o resto do design como está.`);
    $('opt-result').innerHTML = `<table><tr><th>Contrapeso (kg)</th><th>Alcance</th><th></th></tr><tr><td>${+cw.toPrecision(4)}</td><td><b>${got.toFixed(1)} m</b></td><td><button type="button" class="ghost" id="mincw-apply">Aplicar</button></td></tr></table>`;
    $('mincw-apply').addEventListener('click', () => o.apply({ cwMass: +cw.toPrecision(4) }));
  });

  // Range × axle load front (ε-constraint): the best range with no cap, then the best range with the axle capped at
  // 85, 70, 55, 40 and 30 % of the force that design needs. Only what nobody beats on both is listed.
  $('opt-pareto').addEventListener('click', () => {
    const s = setup(true);
    if (!s) return;
    const { armTotal, env3, vars, base, map, kind } = s;
    if (env3) return void status('A fronteira usa o motor plano: desligue a "Vista 3D".');
    const req = (params: OptParams): Request => ({ type: 'optimize', kind, params, vars, objective: 'range', maxEvals: 30 + 25 * vars.length, ...(armTotal !== undefined ? { armTotal } : {}) });
    const won = (r: Reply): r is Extract<Reply, { type: 'optimized' }> => r.type === 'optimized' && r.value > 0;
    let evals = 0;
    const tops: Extract<Reply, { type: 'optimized' }>[] = [];
    status(`Fronteira: achando o melhor alcance sem teto, ${STARTS} partidas…`);
    runPool([map.toUnit(base), ...latinHypercube(STARTS - 1, vars.length)].map((u) => req(map.toParams(u))), {
      each: (r) => won(r) && (tops.push(r), (evals += r.evals)),
      done: () => {
        const top = tops.sort((a, b) => b.value - a.value)[0];
        if (!top) return void status('Nenhuma partida deu um disparo válido. Revise o design.');
        const f0 = axlePeak(kind, top.params);
        const rows = [top.params];
        status(`Fronteira: sem teto o eixo leva ${(f0 / 1000).toFixed(1)} kN. Repetindo sob tetos menores…`);
        runPool([0.85, 0.7, 0.55, 0.4, 0.3].map((c) => req({ ...top.params, axleCap: c * f0 })), {
          each: (r) => won(r) && (rows.push(r.params), (evals += r.evals)),
          done: () => showFront(kind, vars, rows, evals),
        });
      },
    });
  });

  function showFront(kind: Kind, optVars: OptVar[], rows: OptParams[], evals: number) {
    const cols = optVars.flatMap((v): OptKey[] => (v === 'armSplit' ? ['longArm', 'shortArm'] : [v]));
    const pts = rows.map((r) => {
      const p = { ...r, axleCap: undefined }; // the true range and force of the design, without the cap's penalty
      return { p, range: evaluate(kind, p, 'range'), peak: axlePeak(kind, p) };
    }).filter((x) => x.range > 0);
    const front = pts.filter((a) => !pts.some((b) => b.range >= a.range && b.peak <= a.peak && (b.range > a.range || b.peak < a.peak))).sort((a, b) => b.peak - a.peak);
    status(`Fronteira: ${front.length} designs que ninguém bate nos dois critérios (${evals} simulações). Cada linha é o maior alcance achado para aquela força no eixo.`);
    $('opt-result').innerHTML = `<table>
      <tr><th>Força de pico no eixo (kN)</th><th>Alcance</th>${cols.map((k) => `<th>${label(k)}</th>`).join('')}<th></th></tr>
      ${front.map((x, i) => `<tr><td>${(x.peak / 1000).toFixed(1)}</td><td><b>${x.range.toFixed(1)} m</b></td>${cols.map((k) => `<td>${+(x.p[k] ?? 0).toPrecision(4)}</td>`).join('')}
        <td><button type="button" class="ghost" data-front="${i}">Aplicar</button></td></tr>`).join('')}
    </table>`;
    $('opt-result').querySelectorAll<HTMLButtonElement>('[data-front]').forEach((b) =>
      b.addEventListener('click', () => o.apply(Object.fromEntries(cols.map((k) => [k, +(front[Number(b.dataset.front)].p[k] ?? 0).toPrecision(4)])) as Partial<Record<OptKey, number>>)),
    );
  }

  $('opt-run').addEventListener('click', () => {
    const s = setup();
    if (!s) return;
    const { armTotal, env3, vars, base, map, kind, obj } = s;
    const arm = armTotal !== undefined;
    const st = struct();
    const sweep = $<HTMLSelectElement>('opt-mat').value;
    if (sweep && st) return materialSweep(kind, base, vars, obj, st, sweep, armTotal, env3);
    const startsU = [map.toUnit(base), ...latinHypercube(STARTS - 1, vars.length)];
    const reqs: Request[] = startsU.map((u) => ({ type: 'optimize', kind, params: map.toParams(u), vars, objective: obj, maxEvals: 30 + 25 * vars.length, ...(arm ? { armTotal } : {}), ...(env3 ? { env3 } : {}), ...(st ? { struct: st } : {}) }));
    const found: { u: number[]; value: number; params: OptParams; fs?: number }[] = [];
    let evals = 0;
    status(`Otimizando a partir de ${STARTS} pontos em paralelo…`);
    runPool(reqs, {
      each: (r) => {
        if (r.type !== 'optimized') return;
        evals += r.evals * shotsPerEval(obj);
        found.push({ u: map.toUnit(r.params), value: r.value, params: r.params, fs: r.fs });
        status(`Otimizando… ${found.length}/${STARTS} partidas concluídas · ${evals} simulações`);
      },
      done: () => {
        // scores carry the sling cap's / the parts' penalty: the table shows each design's true value, flagged when it breaks them
        const real = (p: OptParams) => (base.slingCap || st ? evaluate(kind, st ? withSectionMass({ ...p, slingCap: undefined }, st.spec) : { ...p, slingCap: undefined }, obj, env3) : undefined);
        showOptima(vars, distinctOptima(found), evaluate(kind, base, obj, env3, st), evals, base, arm ? armTotal : undefined, st, real);
      },
    });
  });

  // Material × commercial size of the arm, ranked by what holds. A quick shot of every pair at the current design
  // first; then one optimization each for, per material, the lightest size that holds there and the next lighter ones
  // (the found geometry may let them hold): 'opt-keep' sizes per material, 2 by default
  function materialSweep(kind: Kind, base: OptParams, vars: OptVar[], obj: Objective, st: Struct, which: string, armTotal: number | undefined, env3: Env3 | undefined) {
    const mats = Object.keys(BAR_MATS).filter((k) => which === 'all' || (which === 'metal') === !!BAR_MATS[k].metal);
    const all = mats.flatMap((mat) => sizesFor(mat).map((z) => ({ mat, size: z.label, arm: { mat, ...z.spec } as PartSpec })));
    const start = armTotal !== undefined ? paramMapper(base, ['armSplit'], armTotal).toParams([base.longArm / (base.longArm + base.shortArm)]) : base; // the piece's length
    const variant = (arm: PartSpec): Struct => ({ ...st, spec: { ...st.spec, arm } });
    const n = Math.max(1, (navigator.hardwareConcurrency || 4) - 1), chunk = Math.ceil(all.length / n);
    const chunks = Array.from({ length: Math.ceil(all.length / chunk) }, (_, i) => all.slice(i * chunk, (i + 1) * chunk));
    const keep = Math.min(6, Math.max(1, Math.round(Number($<HTMLInputElement>('opt-keep').value) || 2)));
    const us: number[] = [];
    status(`Triagem: ${all.length} combinações de material × bitola, um disparo cada…`);
    runPool(chunks.map((c): Request => ({ type: 'screen', kind, params: start, structs: c.map((x) => variant(x.arm)) })), {
      each: (r, i) => r.type === 'screened' && r.u.forEach((u, k) => (us[i * chunk + k] = u)),
      done: () => {
        const mass = (x: (typeof all)[number]) => withSectionMass(start, { arm: x.arm }).armMass;
        const combos = mats.flatMap((mat) => {
          const list = all.map((x, i) => ({ ...x, u: us[i] })).filter((x) => x.mat === mat).sort((a, b) => mass(a) - mass(b));
          const k = list.findIndex((x) => x.u * st.fsMin <= 1);
          return k < 0 ? [] : list.slice(Math.max(0, k + 1 - keep), k + 1);
        });
        if (!combos.length) return void status(`Nenhuma combinação aguenta com FS ≥ ${st.fsMin} no design atual. Tente FS menor, outro critério ou menos contrapeso.`);
        optimizeCombos(kind, base, vars, obj, st, combos, armTotal, env3, all.length);
      },
    });
  }

  function optimizeCombos(kind: Kind, base: OptParams, vars: OptVar[], obj: Objective, st: Struct, combos: { mat: string; size: string; arm: PartSpec }[], armTotal: number | undefined, env3: Env3 | undefined, screened: number) {
    const reqs: Request[] = combos.map((c) => ({ type: 'optimize', kind, params: base, vars, objective: obj, maxEvals: 20 + 15 * vars.length,
      ...(armTotal !== undefined ? { armTotal } : {}), ...(env3 ? { env3 } : {}), struct: { ...st, spec: { ...st.spec, arm: c.arm } } }));
    const rows: { c: (typeof combos)[number]; value: number; params: OptParams; fs: number }[] = [];
    let evals = 0;
    status(`Varrendo ${combos.length} combinações de material × bitola…`);
    runPool(reqs, {
      each: (r, i) => {
        if (r.type !== 'optimized') return;
        evals += r.evals * shotsPerEval(obj);
        rows.push({ c: combos[i], value: r.value, params: r.params, fs: r.fs ?? 0 });
        status(`Varrendo materiais… ${rows.length}/${combos.length} · ${evals} simulações`);
      },
      done: () => {
        const ok = rows.filter((x) => x.value > 0 && x.fs >= 0.97 * st.fsMin).sort((a, b) => b.value - a.value);
        const crit = st.mode === 'rupture' ? 'ruptura' : 'projeto (NBR)';
        if (!ok.length) return void status(`Nenhuma das ${combos.length} combinações aguenta com FS ≥ ${st.fsMin} (${crit}). Tente FS menor, outro critério ou menos contrapeso.`);
        status(`${screened} combinações na triagem, ${combos.length} otimizadas (${evals} simulações): ${ok.length} aguentam com FS ≥ ${st.fsMin} (${crit}). As melhores:`);
        const cols = vars.flatMap((v): OptKey[] => (v === 'armSplit' ? ['longArm', 'shortArm'] : [v]));
        $('opt-result').innerHTML = `<table>
          <tr><th>Material</th><th>Bitola</th><th>Massa do braço (kg)</th>${cols.map((k) => `<th>${label(k)}</th>`).join('')}<th>${OBJECTIVE_NAMES[obj]}</th><th>FS</th><th></th></tr>
          ${ok.slice(0, 12).map((x, i) => `<tr><td>${BAR_MATS[x.c.mat].label}${BAR_MATS[x.c.mat].note ? ` <span class="muted" title="Valores estimados: ${BAR_MATS[x.c.mat].note}">(est.)</span>` : ''}</td><td>${x.c.size}</td><td>${x.params.armMass.toFixed(1)}</td>
            ${cols.map((k) => `<td>${+(x.params[k] ?? 0).toPrecision(4)}</td>`).join('')}
            <td><b>${fmt(x.value)}</b></td><td>${x.fs.toFixed(2)}</td><td><button type="button" class="ghost" data-mat="${i}">Aplicar</button></td></tr>`).join('')}
        </table>`;
        $('opt-result').querySelectorAll<HTMLButtonElement>('[data-mat]').forEach((b) =>
          b.addEventListener('click', () => {
            const x = ok[Number(b.dataset.mat)];
            const { pinOffset, aimDeg, ...rest } = Object.fromEntries([...cols, 'armMass', 'legMass'].map((k) => [k, +(x.params[k as keyof OptParams] ?? 0).toPrecision(5)])) as Partial<Record<OptKey, number>>;
            o.apply3d({ pinOffset, aimDeg });
            o.applyArm(x.c.arm, st.mode);
            o.apply(rest);
          }),
        );
      },
    });
  }

  function showOptima(optVars: OptVar[], all: ReturnType<typeof distinctOptima<{ u: number[]; value: number; params: OptParams; fs?: number }>>, current: number, evals: number, base: OptParams, armTotal?: number, st?: Struct, real?: (p: OptParams) => number | undefined) {
    const vars = optVars.flatMap((v): OptKey[] => (v === 'armSplit' ? ['longArm', 'shortArm'] : [v])); // table columns
    const name = OBJECTIVE_NAMES[objective()];
    const sum = +(o.params.longArm + o.params.shortArm).toFixed(3);
    if (!all.length) return void status(`Nenhuma das ${STARTS} partidas produziu um disparo válido. ` +
      (armTotal !== undefined && armTotal !== sum ? `Com o braço total de ${armTotal} m o design não fecha: tente um total mais perto do atual (${sum} m).` : 'Revise o design.'));
    // optima far below the best are dead ends (often stuck on a slider limit): count them, don't list them
    const optima = all.filter((op) => op.value >= 0.5 * all[0].value);
    const stuck = STARTS - optima.reduce((n, op) => n + op.count, 0);
    // true value of a design (score without the caps' penalty) and whether the penalty bit
    const truth = (score: number, p: OptParams) => { const v = real?.(p) ?? score; return { v, over: score < v * (1 - 1e-6) }; };
    const cur = truth(current, base);
    const flag = (over: boolean) => (over ? ' <span class="muted" title="Passa do teto de força na funda ou do FS mínimo: o valor é o do tiro sem o limite.">(fora dos limites)</span>' : '');
    const gain = (v: number) => (cur.v > 0 && objective() !== 'lateral' && objective() !== 'target' ? ` <span class="muted">(${v >= cur.v ? '+' : ''}${((100 * (v - cur.v)) / cur.v).toFixed(1)}%)</span>` : '');
    const stuckNote = stuck ? ` ${stuck} partida(s) terminaram em designs que falham ou rendem menos da metade, e foram omitidas.` : '';
    status((optima.length === 1
      ? `${STARTS} partidas, ${evals} simulações: todas as que deram certo chegaram ao mesmo ótimo, provavelmente o global nessa faixa.`
      : `${STARTS} partidas, ${evals} simulações: ${optima.length} ótimos locais distintos. Compare as soluções.`) + stuckNote);
    $('opt-result').innerHTML = `<table>
      <tr><th></th>${vars.map((k) => `<th>${label(k)}</th>`).join('')}<th>${name}</th>${st ? '<th>FS</th>' : ''}<th>achado</th><th></th></tr>
      <tr><td>atual</td>${vars.map((k) => `<td>${+(base[k] ?? 0).toPrecision(4)}</td>`).join('')}<td>${fmt(cur.v)}${flag(cur.over)}</td>${st ? '<td></td>' : ''}<td></td><td></td></tr>
      ${optima.map((op, i) => ({ op, i, t: truth(op.value, op.params) })).map(({ op, i, t }) => `<tr><td>${i === 0 ? '<b>melhor</b>' : `#${i + 1}`}</td>
        ${vars.map((k) => `<td>${+(op.params[k] ?? 0).toPrecision(4)}</td>`).join('')}
        <td><b>${fmt(t.v)}</b>${gain(t.v)}${flag(t.over)}</td>${st ? `<td${(op.fs ?? 0) < st.fsMin * 0.97 ? ' class="fail"' : ''}>${(op.fs ?? 0).toFixed(2)}</td>` : ''}<td>${op.count}×</td>
        <td><button type="button" class="ghost" data-opt="${i}">Aplicar</button></td></tr>`).join('')}
    </table>`;
    $('opt-result').querySelectorAll<HTMLButtonElement>('[data-opt]').forEach((b) =>
      b.addEventListener('click', () => {
        const op = optima[Number(b.dataset.opt)];
        const keys: OptKey[] = st ? [...vars, 'armMass', 'legMass'] : vars; // a section's mass follows the found lengths
        const { pinOffset, aimDeg, ...rest } = Object.fromEntries(keys.map((k) => [k, +(op.params[k] ?? 0).toPrecision(st && (k === 'armMass' || k === 'legMass') ? 5 : 4)])) as Partial<Record<OptKey, number>>;
        o.apply3d({ pinOffset, aimDeg }); // before apply(): it re-runs the shot with the fields' values
        if (st) o.applyArm(undefined, st.mode);
        o.apply(rest);
      }),
    );
  }

  $('sw-run').addEventListener('click', () => {
    const x = $<HTMLSelectElement>('sw-x').value as keyof Params;
    const yv = $<HTMLSelectElement>('sw-y').value as keyof Params | '';
    const y = yv && yv !== x ? yv : undefined;
    if (needs3d()) return;
    const title = OBJECTIVE_NAMES[objective()];
    const env3 = o.env3();
    const whatif = $<HTMLInputElement>('sw-whatif').checked && !y && x !== 'releaseDeg';
    if ($<HTMLInputElement>('sw-whatif').checked && !whatif) status('A comparação com o melhor caso vale só para a curva 1D de um parâmetro que não seja o ângulo de soltura.');
    start({ type: 'sweep', kind: o.kind(), params: { ...o.params, ...(objective() === 'target' ? { target: targetM() } : {}) }, x, y, objective: objective(), ...(env3 ? { env3 } : {}), ...(whatif ? { whatif } : {}) }, (r) => {
      if (r.type !== 'swept') return;
      status((whatif ? 'Varredura concluída: o design como está contra o melhor ângulo de soltura em cada ponto.' : `Varredura concluída: ${r.z.flat().length * shotsPerEval(objective())} simulações.`) + ' Clique no gráfico para aplicar um ponto.');
      sweepCanvas.hidden = false;
      const z = r.z.map((row) => row.map(shown));
      if (r.ys && y) {
        const spec: HeatSpec = { title, unit: unit(), xs: r.xs, ys: r.ys, z, xLabel: LABELS[x], yLabel: LABELS[y], current: [o.params[x], o.params[y]] };
        plot = {
          draw: (cx, cy) => drawHeatmap(sweepCanvas, spec, cx === undefined ? undefined : heatCell(sweepCanvas, spec, cx, cy!)),
          click: (cx, cy) => {
            const cell = heatCell(sweepCanvas, spec, cx, cy);
            if (cell) o.apply({ [x]: +r.xs[cell[0]].toPrecision(4), [y]: +r.ys![cell[1]].toPrecision(4) });
          },
        };
      } else {
        const [, name, xUnit = ''] = LABELS[x].match(/^(.*?)(?: \(([^)]+)\))?$/)!; // "Funda (m)" → name, unit
        const spec: ChartSpec = { title: `${title} × ${name.toLowerCase()}`, unit: unit(), t: r.xs, xUnit, marker: o.params[x], markerLabel: 'atual',
          series: whatif && z[1] ? [{ label: 'como está', color: css('--series-1'), values: z[0] }, { label: 'melhor caso (ângulo reotimizado)', color: css('--series-2'), values: z[1] }] : [{ label: title, color: css('--series-1'), values: z[0] }] };
        plot = {
          draw: (cx) => drawChart(sweepCanvas, spec, cx === undefined ? undefined : timeAt(sweepCanvas, spec, cx)),
          click: (cx) => o.apply({ [x]: +timeAt(sweepCanvas, spec, cx).toPrecision(4) }),
        };
      }
      plot.draw();
      sweepCanvas.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });

  sweepCanvas.addEventListener('mousemove', (e) => plot?.draw(e.clientX, e.clientY));
  sweepCanvas.addEventListener('mouseleave', () => plot?.draw());
  sweepCanvas.addEventListener('click', (e) => plot?.click(e.clientX, e.clientY));

  return {
    // re-list the variables when the trebuchet type changes; old sweep no longer matches
    refresh() {
      stopAll();
      busy(false);
      const fields = KINDS[o.kind()].fields.filter((f) => !ENVIRONMENT.includes(f));
      $('opt-vars').innerHTML = fields
        .map((f) => `<label><input type="checkbox" value="${f}" ${DEFAULT_ON.includes(f) ? 'checked' : ''}>${LABELS[f]}</label>`)
        .join('') + (o.env3() ? (['pinOffset', 'aimDeg'] as const).map((k) => `<label><input type="checkbox" value="${k}">${label(k)}</label>`).join('') : '');
      const opts = fields.map((f) => `<option value="${f}">${LABELS[f]}</option>`).join('');
      $('sw-x').innerHTML = opts;
      $('sw-y').innerHTML = '<option value="">— nenhum (curva 1D)</option>' + opts;
      $<HTMLSelectElement>('sw-x').value = 'slingLength';
      $<HTMLSelectElement>('sw-y').value = 'releaseDeg';
      $('opt-result').innerHTML = '';
      status('');
      sweepCanvas.hidden = true;
      plot = undefined;
      $('opt-arm-box').hidden = !(fields.includes('longArm') && fields.includes('shortArm'));
      $<HTMLInputElement>('opt-arm').checked = false;
      armDirty = false;
      syncArm();
    },
  };
}
