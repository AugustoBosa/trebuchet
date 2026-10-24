# Etapa 3 — Direção

## O mecanismo, o público, a cena

- **Mecanismo:** trocar altura por velocidade; o laboratório simula, mede e otimiza 14 máquinas.
- **Público:** engenheiro entusiasta de trebuchets; valida tudo pela física.
- **Cena:** mesa de trabalho, monitor grande, sessões longas de ajuste e comparação; às vezes o celular, para mostrar a alguém.

O caminho óbvio da categoria é o pergaminho medieval (o atual: bege e terracota). O oposto previsível é o painel neon de "simulador". Os dois ficam de fora.

## Candidatos (do mundo do público, não das ferramentas dele)

1. **Prancha de desenho técnico (ABNT/ISO):** carimbo, linhas finas, letra técnica DIN, cotas. Já é a linguagem do canvas.
2. **Memorial de cálculo / manual de engenharia** (Hütte, Shigley): tabelas com régua fina, números alinhados.
3. **Tipografia suíça de cartaz técnico:** grade rígida, um acento.
4. **Caderno de laboratório quadriculado.**
5. **Relatório técnico da NASA (anos 60):** colunas, figuras numeradas.
6. Manuscrito medieval: rejeitado (é o tema literal).
7. Painel de instrumentos: rejeitado (fantasia de ferramenta).

## Direção escolhida: **Prancha técnica** (1 + 2)

A página é uma prancha: papel neutro, tinta quase preta, réguas finas em vez de cartões, e um único acento, o **laranja de revisão** (a cor que marca o que mudou num desenho). Os resultados são um **carimbo**: células que dividem as mesmas linhas, com o alcance na célula grande. A física vira **memorial**: tabela com régua fina.

- **Letra:** Bahnschrift, a DIN 1451 do Windows (é a letra técnica alemã de normas, não fantasia). Reserva: `Barlow`, `DIN Alternate`, `system-ui`. Números tabulares em tudo que é medida.
- **Cor:** neutros levemente frios (papel `#f6f5f1`, painel `#ecebe6`; escuro `#131518`/`#1a1d21`), acento laranja de revisão `#c2410c` (escuro `#f0803c`). Acento só em ação principal, seleção e estado. Séries dos gráficos mantidas.
- **Superfície:** lateral em um segundo neutro (painel), conteúdo no papel. Elevação declarada uma vez: réguas de 1 px, sem sombras, exceto a ficha flutuante e diálogos.
- **Ícones:** SVG desenhados em traço único (1,5 px), no lugar de ⓘ ✎ ✕ ▾.
- **Movimento:** 150–200 ms só em estado (abas, hover, barra de progresso). O momento autoral é o próprio disparo.

## Estrutura (resolve as prioridades da etapa 1)

- **Desktop:** cabeçalho fino (título, tipo, sobre, a física). Lateral de 360 px com rolagem própria e abas **Projeto · Otimizar · Designs**; "Disparar" fixo no pé da lateral. Área de trabalho com rolagem própria: a máquina e o carimbo de resultados ficam sempre visíveis enquanto se mexe na lateral.
- **Projeto:** parâmetros da máquina primeiro; ar, arrasto e atritos num grupo recolhível "Ambiente e atrito".
- **Resultados:** alcance e eficiência com o delta contra o tiro anterior; o resto em linha secundária.
- **Desfazer / Refazer** (botões + Ctrl+Z / Ctrl+Shift+Z) para parâmetros, troca de tipo e "Aplicar".
- **Celular:** cabeçalho com título e tipo no topo, máquina, carimbo, depois as abas.
- **Números:** formato pt-BR único (`Intl.NumberFormat`).

Uma ação primária por área: Disparar (lateral), Otimizar (aba Otimizar). Salvar vira secundário.
