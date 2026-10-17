# Registro do projeto

Simulador de trebuchets (Vite + TypeScript). Rodar: `npm run dev` · testes: `npm test` · build: `npm run build`.

## Em aberto

### Física / realismo
1. **Walking arm: 69 m contra 81 m do recorde (Stapleton, 2018).** A bola ainda parte do chão. Testei um apoio no braço (contato unilateral `ledge`), mas a geometria real do suporte não é pública e o modelo não fechou de forma confiável (a bola caía do apoio ou nunca saía dele). Retomar se aparecer a geometria do suporte (fotos ou medidas).
2. **Simplificações marcadas com `ponytail:` no código.** Rever só se algum resultado parecer fisicamente errado:
   - sem atrito estático (`solver.ts`, normal defasada);
   - sem restituição: nada quica;
   - roletes sem atrito de rolamento (`presets.ts`).
3. **Tipos não feitos: VLR, Fiffer, Merlin, BAKA.** Não há geometria utilizável nas fontes públicas.

### Editor / UI
1. **Tambor desenhado no editor só desenrola com o braço girando no sentido horário**, que é o dos presets. Uma máquina espelhada enrola a corda sem aviso.
2. **Pontos encaixam na grade de 5 cm.** Uma ponta de mola ou corda presa a uma barra diagonal pode cair fora dela; aparece o anel vermelho de "conexão solta". Isso já acontecia antes com a corda.

### 3D (branch `feat/3d`)
1. **Levar `feat/3d` para o `main`.** O `main` (até 2794b02) já está mesclado no branch, com as juntas novas do editor (espeto, rolete, piso, mola, tambor) suportadas no `compile3()`. Falta só o fast-forward: `git merge --ff-only feat/3d` no checkout do `main`, quando nenhuma outra sessão estiver editando lá. Uma junta nova no futuro precisa de versão em `src/physics3d/constraints3.ts`, `lift.ts` e `sketch3.ts`, e de um caso no teste de paridade.
2. **Walking arm sem alças de geometria** no 2D nem no 3D (ele é desenhado já inclinado pelo empurrão de disparo): em 3D só tem o nó do pino.
3. **O solver 3D roda na thread da página** (0,1–0,5 s por tiro; o walking arm com 1,5 s após a soltura chega perto de 1 s). Movê-lo para o worker se travar a interface.
4. **Eixos de articulação sempre em z.** Um eixo inclinado (máquina torta de propósito) exigiria editar `axis` no esboço.

## 2026-10-16: vista e física 3D (branch `feat/3d`)

- **Vista 3D (botão "Vista 3D" sobre a máquina):** three.js carregado só quando o botão é usado (chunk separado de ~147 kB gzip; o bundle 2D não cresce). A máquina ganha profundidade: pórtico duplo, eixo, trilhos, tambor do MURLIN, funda e trajetória 3D, com câmera giratória (arrastar gira, roda dá zoom).
- **Solver 3D próprio (`src/physics3d/`):**
  - corpos de 6 graus de liberdade, com quaternion, M⁻¹ em blocos `R·I⁻¹·Rᵀ` e torque giroscópico;
  - articulação = 3 linhas de ponto + 2 de alinhamento; stop, solda e tambor usam o ângulo de torção em torno do eixo;
  - mesma estrutura do solver 2D (Baumgarte, RK4, impactos inelásticos, soltura pelo ângulo de elevação), com atualização exata do quaternion;
  - `lift()` converte qualquer preset 2D.
- **Validação:**
  - os 13 tipos dão o mesmo alcance, força no eixo e eficiência que o solver 2D, com diferença de ~1e-12, e desvio lateral exatamente 0 (`test/parity3d.test.ts`);
  - pêndulo cônico (período e altura);
  - corpo livre conservando o momento angular e virando no eixo intermediário (efeito Dzhanibekov);
  - vento simétrico.
- **Física só do 3D:**
  - vento lateral; o vento de 5 m/s desvia de 3 a 5 m (a estimativa analítica dá ~3,6 m);
  - pino de soltura fora do centro; cada 10 cm desviam ~0,7 m no articulado, de forma linear e antissimétrica;
  - card "Desvio lateral".
- **Edição de nós em 3D ("Editar nós"):**
  - nos presets, as alças se movem no plano; a ponta do braço longo também move o pino em z;
  - no editor livre, cada ponto ganha profundidade z (campo `z` no esboço, salvo e importado);
  - os pontos de junta sobre uma barra acompanham a barra quando ela muda;
  - `compile3()` monta o mecanismo 3D, com barras inclinadas e eixos em z.
- **Otimizador 3D (com a vista 3D ligada):**
  - otimização e varredura rodam no motor 3D;
  - novos objetivos: *Desvio lateral mínimo* e *Alcance robusto* (média − σ de 5 tiros: soltura ±2°, rajada ±3 m/s);
  - variável nova *Pino fora do centro*;
  - exemplo: com vento de 2 m/s, o pino de 25 cm leva o desvio de 1,65 m para 0,02 m.
- **Bug corrigido:** o editor 2D entrava em laço infinito ao desenhar a grade num canvas escondido (largura 0); acontecia ao abrir o editor livre na vista 3D.

## 2026-10-16

### Itens maiores (terceira leva)
- **Densidade do contrapeso (`cwDensity`, kg/m³)** em todos os tipos com contrapeso, de 1000 a 11300 (pedra 2500, ferro 7800, chumbo 11300).
  - Mesma massa e mesma energia; mais denso = contrapeso menor.
  - Exemplo: articulado com haste de 1,6 m. Com pedra, o contrapeso bate no chão; com ferro, dá 233 m (o padrão é 225 m).
  - Os presets continuam em 2500, exceto o walking.
  - Designs importados agora têm os valores limitados às faixas dos controles (densidade 0 daria contrapeso infinito).
- **Walking arm: 54 m → 69 m.** 17,5 lb de pesos metálicos = ferro. Com o contrapeso menor, ele tem mais folga do chão.
  - Ajuste robusto procurado no passo de 0,5 ms: perna a 27°, funda de 0,67 m, soltura a 37°.
  - Dá 68,7 m, e no pior caso (±2°/±3 cm/±3°) 64,6 m.
  - Com pedra, a mesma busca dá ~58 m.
- **Editor livre com 5 ferramentas novas: Espetos, Rolete, Chão (pouso/trilho), Mola e Tambor (com polia opcional).**
  - Os 13 tipos abrem no editor e dão o mesmo disparo (teste de ida e volta para todos).
  - A análise de graus de liberdade ignora contatos que começam abertos (`startsActive`, compartilhado com o solver). Antes, F2K e walking apareciam como "travados".
- O vitest só procura testes em `test/`, para não rodar as cópias em `.claude/worktrees`.

| Tipo | Alcance | η |
|---|---|---|
| walking | 54 → 69 m | 50 → ~71% |
| demais | inalterados (tabela abaixo; teste de regressão em `test/density.test.ts`) | |

### Correções rápidas (segunda leva)
- **Celular:** o canvas da máquina passou de 440 para 300 px (`data-h` definido em `main.ts` para ≤ 800 px). Os controles começam ~140 px mais acima.
- **Salto de layout:** um canvas ainda não desenhado ficava com a proporção 300×h (o `#heat` chegava a ~1000 px e as mini-simulações do `learn.html` também). `sizeCanvases()` em `charts.ts` fixa a altura no carregamento das duas páginas.
- **Otimizador no walking arm:**
  - a dica do braço total avisa para ficar perto do total atual;
  - quando nenhuma partida dá certo com outro total, a mensagem sugere voltar para perto do atual em vez de "Revise o design".

### Primeira leva
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
