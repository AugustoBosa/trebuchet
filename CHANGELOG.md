# Registro do projeto

Simulador de trebuchets (Vite + TypeScript). Rodar: `npm run dev` · testes: `npm test` · build: `npm run build`.

## Em aberto

### Física / realismo
1. **Walking arm: 54 m contra 81 m do recorde (Stapleton, 2018).** Falta o projétil partir de uma plataforma no braço. ~2–3 h.
2. **Densidade do contrapeso por tipo** (ferro × pedra), que muda o tamanho do CW e a folga com o chão. ~1 h.
3. **Simplificações marcadas com `ponytail:` no código.** Rever só se algum resultado parecer fisicamente errado:
   - sem atrito estático (`solver.ts`, normal defasada);
   - sem restituição: nada quica;
   - roletes sem atrito de rolamento (`presets.ts`).
4. **Tipos não feitos: VLR, Fiffer, Merlin, BAKA.** Não há geometria utilizável nas fontes públicas.

### Editor / UI
1. **O editor livre não tem ferramentas para tambor, rolete, mola e espetos de pouso.** Hoje recusa os tipos cam/roller. ~0,5–1 dia.
2. **Otimizador no walking arm:** com o braço total diferente do atual, quase nenhum tiro sai válido. Avisar o usuário ou estreitar os limites.
3. **No celular, o canvas da máquina tem 440 px de altura** e ocupa mais da metade da tela. Dá para reduzir para ~300 px. ~10 min.
4. **Canvas ainda não desenhado usa a proporção padrão 300×h.** Exemplo: `#heat` no `learn.html` fica com ~1000 px até a varredura terminar, e o layout pula. Basta uma regra de CSS.

## 2026-10-16

- **Git:** repositório criado (branch `main`) com `.gitignore` para `node_modules`, `dist`, logs e `.claude/settings.local.json`.
- **Bug de canvas em telas hi-DPI (já existia):** `fitCanvas` lia a altura do atributo `height` e gravava `h·dpr` nele. Com DPR > 1, cada redesenho multiplicava a altura (no teste, até 76 000 px). A altura lógica agora fica em `data-h`, via `cssHeight()` em `src/charts.ts`, usada também pelo editor e pelo heatmap.
- **Layout no celular (≤ 800 px):** máquina e resultados aparecem acima do painel de controles, e os gráficos depois. Só CSS: `section { display: contents }` + `order`.
- **Textos do `learn.html` (NOTES em `src/learn.ts`) conferidos com o simulador:**

  | Tipo | Antes | Agora | Simulador |
  |---|---|---|---|
  | whipper | ~270° | ~280° | 284° |
  | F2K | ~13% | ~12 pontos de η | 70% × 82% |
  | MURLIN | "quase toda a energia fica no braço" | "com metade do braço, vai mais longe que o articulado" | η 72%; 313 m × 225 m |
  | floating | "quase toda a queda" | "η ≈ 80%" | 82% |
  | walking, FAKA | datas | "Moderno" | datas não confirmadas |

- Removido comentário desatualizado ("corda nunca afrouxa") em `src/physics/constraints.ts`. A corda é unilateral desde o Whipper.

### Números de referência (presets padrão, após as mudanças)

| Tipo | Alcance | η |
|---|---|---|
| fixed | 184 m | 56% |
| hinged | 225 m | 79% |
| floating | 259 m | 82% |
| traction | 217 m | 86% |
| whipper | 395 m | 73% |
| walking | 54 m | 50% |
| murlin | 313 m | 72% |
| wheel | 270 m | 94% |
| f2k | 296 m | 70% |
| fet | 258 m | 82% |
| ka | 377 m | 62% |
| faka | 499 m | 85% |
| spring | 229 m | 83% |

## 2026-10-15

- **Revisão de acessibilidade e visual:**
  - aria-labels, live regions e foco visível;
  - contraste no modo escuro corrigido (token `--on-accent`) e paleta dos gráficos validada para daltonismo;
  - alvos de 44 px em telas de toque, `prefers-reduced-motion` e tabela "Ver dados dos gráficos".
- **Diálogo "ⓘ Sobre este tipo"** e deep link `./?kind=<tipo>`.
- **Walking arm:** um pé que se soltava era apagado e a máquina atravessava o chão. Agora vira contato de chão. Há teste de regressão.
- **`learn.html` reescrito:**
  - linha do tempo, anatomia, quadros reais do tiro e voo com/sem ar;
  - heatmap 9×9 real e ranking dos 13 tipos;
  - uma seção por tipo com mini-simulação.
- **Otimizador:** guia "ⓘ Como usar" e opção "Distribuir o braço", que mantém braço longo + curto = total.
- **Novos tipos:**
  - MURLIN e Wheel (junta `cam`);
  - F2K (junta `roller` + chão que começa aberto);
  - FET, King Arthur, FAKA;
  - Spring (molas com energia elástica).
- **Solver:** impulsos descartam juntas unilaterais com sinal errado, começando pelo pior caso.

## 2026-10-14

- Otimizador multi-start, com tabela dos ótimos locais.
- Ferramenta de tração no editor livre.
- Soltura interpolada no cruzamento exato: dt de 2 ms no otimizador e 0,5 ms na UI.
- **Whipper:** junta `stop`, cordas que afrouxam e contatos que reativam com impacto.
- **Walking arm:** juntas `foot`/`spike`, geometria do Instructables de Stapleton.

## Antes

- Fases 1–7: motor de restrições (Lagrange), presets fixed/hinged/floating/traction, gráficos, editor livre, otimizador em worker, import/export JSON e CSV.
