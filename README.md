# Laboratório de Trebuchets

Simulador de trebuchets no navegador (Vite + TypeScript, sem servidor): 14 tipos de máquina, solver de corpos rígidos próprio em 2D e 3D, otimizador, editor livre e verificação estrutural com materiais brasileiros.

```bash
npm install
npm run dev      # laboratório em http://localhost:5173 (a página `learn.html` explica a física)
npm test         # vitest
npm run build    # tsc + vite build
```

## O que tem

- **14 tipos:** contrapeso fixo, articulado, floating arm, tração humana, whipper, walking arm, MURLIN, roda, F2K, FET, King Arthur, FAKA, mola e Fiffer. Mais um editor livre (corpos, juntas, cames, molas, roletes, espinhos).
- **Solver próprio** com restrições, contatos unilaterais (cordas que afrouxam, pés que descolam, rodas que pousam), atrito de mancal, arrasto e vento. A versão 3D dá dispersão (elipses de 1σ/2σ), desvio lateral e exportação glb/stl.
- **Otimizador** (Nelder–Mead de 8 partidas em paralelo): alcance, eficiência, distância-alvo (e contrapeso mínimo para ela), desvio lateral e alcance robusto; braço de comprimento total fixo; varredura de material × bitola; fronteira alcance × força no eixo; teto de força na funda (projétil frágil); "What If" que compara a varredura com o melhor ângulo de soltura.
- **Estrutura:** as peças quebram durante o tiro (ruptura ou critério de projeto NBR 8800 / madeira), com 27 madeiras do IPT, aços, alumínios e cordas.
- **Compartilhar:** "Copiar link" põe o design inteiro no fragmento da URL (nada vai para servidor). Também há JSON e CSV.

## Validação

A física foi conferida contra fontes externas, e os testes guardam os números (veja `CHANGELOG.md`):

| Máquina | Fonte | Resultado |
|---|---|---|
| Articulado instrumentado (Aarhus) | Horsdal et al., arXiv:2502.19442, tabela 1 | aceleração inicial, ponto de soltura e alcance sem atrito dentro de 2%; atrito dos mancais pela eq. (8) do artigo (`test/horsdal.test.ts`) |
| Três máquinas otimizadas (viga uniforme) | Horsdal et al., tabela 4 | alcance dentro de 1%, energia dentro de 1% e eficiência dentro de 1 ponto; escala ×2 dá alcance ×2 (`test/horsdal.test.ts`) |
| Fiffer (First in Fright) | simulador dos próprios inventores (treygreer/treb) | soltura em 0,6780 s contra 0,6783 s (`test/fiffer.test.ts`) |

Limite conhecido: com atrito e ar, o corpo rígido fica 13–18% acima dos tiros de campo de Horsdal, a mesma diferença que o artigo encontra no próprio cálculo ab initio (cavalete e viga flexíveis não entram no modelo). Nada foi ajustado para fechá-la.

## Estrutura

`src/physics` (solver plano) · `src/physics3d` (solver 3D) · `src/presets.ts` (os tipos) · `src/optimize.ts` (otimizador) · `src/structure.ts`, `src/parts.ts`, `src/materials.ts` (peças e verificação) · `src/main.ts` (interface) · `test/` (testes).

O histórico de decisões e o que ficou de fora e por quê estão em `CHANGELOG.md`.
