# Etapa 2 — Crítica visual

Data: 2026-10-23 · Modo: **Operate** (o usuário está numa tarefa: projetar, disparar, comparar). `learn.html` é **Read**.

## O que dá a cara de "AI slop"

| # | Sintoma | Onde | Por que incomoda |
|---|---|---|---|
| 1 | Tudo é cartão com borda de 1 px e raio 8 px | `.stat`, `#physics`, `fieldset`, canvases | Nenhuma hierarquia: o alcance pesa o mesmo que "Perdas 307,5 J" |
| 2 | Bege + terracota + `system-ui` | `:root` | É a paleta "antiga/medieval" literal do tema: fantasia de castelo num laboratório de engenharia |
| 3 | Botão terracota cheio em Disparar, Otimizar e Salvar | barra lateral | Três primários; o olho não sabe onde ir |
| 4 | Glifos no lugar de ícones: ⓘ ✎ ✕ ▾ | info, editor, fichas | Peso e alinhamento inconsistentes entre fontes |
| 5 | Espaçamento uniforme de 6–12 px | todo lugar | Grupos não se separam; a lateral vira uma lista contínua de 98 controles |
| 6 | Números em `system-ui` proporcional, formato inglês | resultados | Colunas não alinham; `183.8` ao lado de `1,25` |
| 7 | Superfície única (`--bg`) para lateral e conteúdo | layout | Painel de controle e área de trabalho se confundem |
| 8 | `learn.html` em Georgia com outra paleta copiada à mão | tokens duplicados | Dois sites |

## O que fica

- O desenho da máquina no canvas: traço limpo, fundo vazio. É o melhor elemento da página.
- As cores das séries dos gráficos (validadas para daltonismo em 2026-10-15).
- Os textos: técnicos, em pt-BR, explicam o porquê. A crítica é de forma, não de conteúdo.
- Tema claro e escuro pelo sistema.

## Decisão

Redesenho, não polimento: trocar o mundo visual (paleta, tipo, superfícies, hierarquia) mantendo conteúdo, funções e ids do DOM. Ver etapa 3.
