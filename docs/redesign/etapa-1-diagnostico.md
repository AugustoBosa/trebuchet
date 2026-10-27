# Etapa 1 — Diagnóstico de usabilidade

Data: 2026-10-23 · Escopo: `index.html` (laboratório) e `learn.html` · Método: 10 heurísticas de Nielsen + análise de 6 tarefas, medido no navegador (desktop 1024×768 e celular 375×812, tema escuro).

Severidade (Nielsen): 0 não é problema · 1 cosmético · 2 menor · 3 maior · 4 catástrofe.

## Números medidos

| Medida | Valor |
|---|---|
| Controles na barra lateral | 98 (inputs, selects, botões) |
| Altura da barra lateral, desktop | 2764 px (3,6 telas) |
| Parâmetros do "Contrapeso fixo" | 16, todos com o mesmo peso visual |
| Página no celular | 5748 px (7 telas) |
| Resultado do otimizador, desktop | começa em y = 2138 px; o desenho já saiu da tela |
| Bloco "Designs" (salvar/compartilhar) | y = 2531 px, fim da barra lateral |
| Celular: seletor de tipo | y = 836 px, abaixo da dobra e abaixo de "Disparar" |
| Otimização padrão (2 variáveis) | 7 s, 253 simulações |

## Tarefas

| # | Tarefa | Hoje | Atrito |
|---|---|---|---|
| T1 | Primeiro tiro (novo usuário) | Abre já com o resultado calculado; "Disparar" fixo no rodapé da lateral | Os números aparecem antes da animação: não fica claro se "Disparar" calcula ou só anima |
| T2 | Mexer num parâmetro e comparar | Resultado atualiza ao vivo (183,8 → 201,4 m) | O valor anterior some. Não há antes/depois nem delta |
| T3 | Otimizar | Rolar ~1100 px, marcar variáveis, Otimizar, rolar mais ~1000 px | Tabela espremida em 300 px; a máquina sai da tela; "Aplicar" sobrescreve sem desfazer |
| T4 | Salvar / compartilhar | Bloco no fim da lateral | Achar exige rolar 3 telas |
| T5 | Montar no editor livre | 17 ferramentas num grid 3×6 plano | Sem grupos (estrutura / juntas / contatos / energia); títulos só no hover |
| T6 | Ver em 3D / vento | Botão "Vista 3D" acima do desenho | OK. Controles 3D aparecem no topo, longe dos outros |

## Achados por heurística

| H | Achado | Sev. |
|---|---|---|
| 1 Visibilidade do estado | Resultado do otimizador e status ficam longe do desenho; o estado "calculado vs animado" do tiro é ambíguo | 3 |
| 1 | Barra de status do otimizador em texto cinza pequeno, sem progresso visual | 2 |
| 2 Linguagem do mundo real | Número em formato inglês nos resultados (`183.8 m`, `4.864`) e brasileiro nos campos (`1,25`) | 2 |
| 2 | Jargão sem âncora na tela: η, FS, NBR, μ, Cd, "restituição e" | 1 |
| 3 Controle e liberdade | Sem desfazer nos parâmetros dos presets, na troca de tipo e no "Aplicar" do otimizador (o editor livre tem Ctrl+Z) | 3 |
| 4 Consistência | Três botões primários competindo (Disparar, Otimizar, Salvar); dois controles de "quebra" com as mesmas opções (`#break` e `#opt-struct-mode`) | 2 |
| 5 Prevenção de erros | 11 variáveis liberáveis no otimizador sem aviso de custo; tipos sensíveis (walking arm) falham sem explicar por quê | 2 |
| 6 Reconhecer em vez de lembrar | Parâmetros de projeto misturados com ambiente (ar, Cd, atrito, raio do eixo); a lista de variáveis do otimizador repete os nomes longe dos sliders; a dica do parâmetro aparece num `#hint` fixo, longe do controle | 3 |
| 7 Flexibilidade | Atalhos no 3D, link de compartilhamento, JSON, CSV: bom | 0 |
| 8 Estética minimalista | Lateral de 3,6 telas; 8 cartões de resultado iguais (o alcance não domina); "Para onde foi a energia" em prosa; tudo em cartões com borda de 1 px e `system-ui`: é a origem da impressão de "AI slop" | 3 |
| 9 Recuperar de erros | `#err`, aviso de quebra, "(fora dos limites)" no otimizador: claros | 1 |
| 10 Ajuda | Muita ajuda, mas o "Como usar" do otimizador é um diálogo de ~40 linhas; as dicas dos 17 botões do editor só existem no hover (inacessíveis no toque) | 2 |

## Celular

| Achado | Sev. |
|---|---|
| Sem título e sem seletor de tipo acima da dobra: o usuário vê a máquina sem saber qual é | 3 |
| Página de 7 telas; gráficos começam em y = 4814 | 2 |
| `title` como única explicação (botões do editor, opções de quebra, 3D): não existe no toque | 2 |

## Acessibilidade (já feito vs. falta)

Já feito em 2026-10-15: aria-labels, foco visível, contraste ≥ 4,5:1, alvos de 44 px no toque, `prefers-reduced-motion`, tabela de dados dos gráficos.
Falta: dicas em `title` (não lidas por leitores de tela de forma confiável nem no toque); `#hint` não está ligado ao controle por `aria-describedby`; os 17 botões do editor não são um `role=toolbar` com `aria-pressed` (o 3D já é).

## Prioridades para as etapas seguintes

> Registro do diagnóstico de 2026-10-23. Os itens abaixo foram tratados nas etapas 3 a 6 (`etapas-4-a-6.md`); o editor livre ficou com 3 grupos de ferramentas, não 4.

Fazer primeiro (sev. 3):
1. **Layout em áreas de trabalho**: a máquina e os resultados sempre visíveis; a lateral vira abas/seções recolhíveis (Projeto · Ambiente · Otimizar · Designs). Ataca T3, T4, H1, H6, H8.
2. **Hierarquia dos resultados**: alcance e eficiência grandes; picos de força e perdas em segundo plano; delta contra o tiro anterior (T2).
3. **Desfazer** para parâmetros, troca de tipo e "Aplicar".
4. **Celular**: título + tipo + Disparar acima da máquina.

Depois (sev. 2):
5. Formato numérico pt-BR único (`Intl.NumberFormat('pt-BR')`).
6. Um só botão primário por área.
7. Parâmetros de ambiente separados dos de projeto.
8. Editor livre: ferramentas em 4 grupos com legenda visível.
9. Dicas fora do `title`: texto ligado por `aria-describedby`.

Entrada para a etapa 2 (crítica visual): o item 8 da tabela de heurísticas (cartões iguais, `system-ui`, bordas em tudo) é o alvo da crítica com impeccable + visual-critique.
