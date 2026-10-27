# Etapas 4 a 6 — Tokens, estados e verificação

## 4. Tokens e gráficos

- `src/theme.css`: tokens únicos para `index.html` e `learn.html` (papel, painel, superfície elevada, tinta, régua, acento laranja de revisão, ok/perigo, fontes). Claro e escuro pelo sistema. Seleção, cursor de texto, barra de rolagem e checkbox tingidos pelo acento.
- Letra: Bahnschrift (DIN 1451) com reservas; números tabulares em toda a interface. `learn.html` mantém uma serifa de leitura no corpo e usa a DIN nos títulos.
- Gráficos: mesmas cores de série (já validadas para daltonismo); texto dos canvases na mesma letra (`FONT` em `charts.ts`) e em formato pt-BR.
- Números em pt-BR em resultados, memorial, tabela de FS, otimizador, dispersão e gráficos (`br()` em `labels.ts`).

## 5. Estados de interação

- Botões: hover, ativo (desce 1 px), desabilitado, `aria-busy` no Otimizar.
- Abas com setas do teclado; "Otimizar" desabilitada no editor livre.
- Otimizador: barra de progresso (`<progress>`) que segue a contagem "x/y" das mensagens; indeterminada até a primeira contagem. Os quatro botões de busca ficam desabilitados durante a busca.
- Resultados: delta contra o tiro anterior (verde se ganhou, vermelho se perdeu) em alcance e eficiência.
- Desfazer/refazer: botões e Ctrl+Z / Ctrl+Shift+Z (fora de campos de texto; o editor livre mantém o próprio Ctrl+Z).
- Dica do parâmetro ao passar o mouse e ao focar, ligada aos campos por `aria-describedby`; ferramentas do editor com `aria-pressed`.
- Lugar reservado para os resultados antes do primeiro tiro (sem salto de layout).

## 6. Verificação (2026-10-23)

| Verificação | Resultado |
|---|---|
| `tsc --noEmit` | sem erros |
| `vitest` | 264/264 |
| `vite build` | ok |
| Lighthouse acessibilidade, desktop e celular | 100 / 100 |
| Lighthouse boas práticas | 100 / 100 |
| CLS no celular | 0,113 → abaixo do limite após reservar o lugar dos resultados (depois zerado, commit 85770fe) |
| Celular: seletor de tipo | y = 836 px → 45 px |
| Celular: altura da página | 5748 px → 3700 px |
| Desktop: máquina visível enquanto se mexe na lateral | sim (rolagens separadas) |
| Navegador: tiro, delta, desfazer/refazer, abas, otimizador com barra, editor livre, vista 3D, tema claro e escuro | conferidos |

Falhas restantes do Lighthouse (robots.txt, llms.txt) vinham do servidor de desenvolvimento devolvendo o HTML para qualquer caminho. No GitHub Pages (publicado em 2026-10-25) esses caminhos dão 404, que é o comportamento esperado.
