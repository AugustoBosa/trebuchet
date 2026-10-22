# Registro do projeto

Simulador de trebuchets (Vite + TypeScript). Rodar: `npm run dev` · testes: `npm test` · build: `npm run build`.

## 2026-10-22: flexão lateral no 3D, torre da polia, fechamento de pendências

- **3D:** o solver 3D passa a calcular N, V e M ao longo das barras, mais a parte lateral (Vl, Ml: pino deslocado, vento de lado). A verificação do braço soma σ = N/A + M/W + Ml/Wl e usa o cisalhamento resultante. No plano os valores batem com o solver plano (`test/loads3d.test.ts`). Em desenho livre no 3D a verificação continua sem esforços.
- **Torre da polia (MURLIN):** coluna engastada no chão, com flexão + normal e flambagem de Euler (2H). Seção e material na ficha "Tambor e corda do contrapeso". Só verifica quando você informa a seção.
- **Esmagamento do furo** no aço segue a NBR 8800 (2,4·f_u; ÷ 1,35 no projeto); `fu` entrou nos metais.
- **Otimizador:** "Bitolas otimizadas por material" (1 a 6, padrão 2).
- O tambor espelhado no editor livre já funcionava (`camDir`); só havia um comentário velho.
- **Não feito:** trilho dos floating arms. O modelo não tem comprimento nem seção do trilho (é um apoio infinito), então não há o que verificar sem inventar dados.

## Em aberto

Nada. Os itens que sobravam foram investigados a fundo em 2026-10-22 (texto, código-fonte dos inventores e vídeos) e estão fechados abaixo.

## 2026-10-22: Fiffer feito; walking arm, VLR, Merlin e BAKA investigados e fechados

- **Fiffer (feito, `src/fiffer.ts`).** A fonte era o simulador publicado pelo próprio time First in Fright (github.com/treygreer/treb, `first_in_fright_2012/2013.py`), com toda a geometria (elos de 2,61 e 2,98 pés resolvidos pelo ângulo de 10°, biela de 10,45 pés, braço de 9 pés dobrado, rampa de 11 pés, queda de 5 pés) e as massas de cada peça. O "ponto morto" da reconstrução anterior era artefato de proporções estimadas: o ângulo de transmissão da biela vai de 26° a 180° sem travar.
  - **Validação** (`test/fiffer.test.ts`), rodando o simulador original (com PyQt stubado) na configuração 2026 (8 lb, funda 9,54 ft, 30°): com o pé do pórtico rígido, o original solta em 0,6783 s a 119,3 m/s; o nosso, em 0,6780 s a 118,7 m/s. Massa e inércia do braço batem exatamente (90,58 kg, 76,32 kg·m²). A energia total se conserva (0,5% dissipado).
  - O README deles dá 2.177 ft / 0,683 s / 116 m/s: o pé dianteiro do pórtico deles está numa mola amortecida que dissipa ~8% da energia. O nosso chão é rígido.
  - O alcance do preset (funda 8,55 ft, 10 lb, 35°) é ~2.300 ft. Contra os medidos no Punkin Chunkin 2010 (1.815 → 1.920 ft), o modelo é otimista, como se espera de uma máquina sem folgas e sem efeitos de abóbora real.
  - Diferenças assumidas: rampa de 5 kg (no original é sem massa); estabilizador da biela sobre o eixo (3" fora no original); barras desenhadas com comprimento cobrindo todos os pinos. A conversão para o editor livre muda o alcance em ~3% (inércias compostas viram barra uniforme).
  - A eficiência pode passar de 100%: o insumo do solver é só a queda do contrapeso, e os elos e a biela também descem.
  - Variante com correia e came do protótipo do beardedone85: sem medidas (raio do came, comprimento da correia). Não feita.
- **Walking arm: fechado, calibração só.** Fonte primária completa lida (Instructables, passos e 77 comentários). O recorde de 81 m (2018) é do filho de 8 anos do autor, com uma máquina de 20 lb, bola de 3 oz e plataforma com gatilho. Geometria do ninho conhecida (palitos a 4″ do eixo, funda de ~30″), mas atrito do saquinho, instante da soltura (dedo entortado à mão) e folga do eixo não existem em nenhuma fonte; a única meta observável é um ângulo de soltura de ~45° estimado por um comentarista. Qualquer valor ajustado para dar 81 m seria calibração, não validação. Fica em ~69 m.
- **BAKA: fechado.** Significa "Bent Arm King Arthur" (braço longo dobrado 90° para frente, razões ~3:1:1 da altura do eixo, cabos-guia da ponta do braço longo à do curto). Só há razões, sem medidas, massas ou alcance, e o arranjo dos cabos-guia não é descrito. Um preset seria invenção sem validação.
- **VLR: fechado.** "Variable Leverage Remote Drop": uma frase de princípio (corda puxada de um ponto remoto, contrapeso puxa o meio de um vão). Nenhuma medida.
- **Merlin: fechado.** Chris Gerow (Super Trebuchets), 15 m de altura, 229 m em 2007 e 322 m em 2008 (Punkin Chunkin). Base de projeto: contrapeso de 272 kg, braço de 3,66 m, trilho a 40°. A curva do trilho em J, as massas reais e a posição do pivô flutuante nunca foram publicadas; as páginas de histórico do projeto que as teriam estão fora do ar.

## 2026-10-18: materiais brasileiros, quebra estrutural e otimização com uma peça disponível

- **Materiais do Brasil** (`src/materials.ts`). Os valores são médias de ensaio, e as estimativas estão marcadas.
  - 27 madeiras: 24 do IPT (manual *Madeira: uso sustentável na construção civil*, a 12–15 % de umidade), Ipê e Cumaru (fichas CIRAD Tropix) e Maçaranduba (EN 408).
  - Aços SAE 1020/metalon, A36, SAE 1045, inox 304; alumínio 6063-T5 e 6061-T6.
  - Cordas de sisal, polipropileno, poliéster, nylon, cabo de aço e Dyneema.
  - Os nomes antigos (C24, D30, D40, S235, S355) viram o equivalente brasileiro.
- **Seções e bitolas comerciais.** Formas: retangular, redonda, tubo retangular e tubo redondo. Bitolas: sarrafo, caibro, pontalete, vigota, viga, pilar, roliço, metalon, tubos e barra. A massa do braço vira ρ·A·L.
- **Esforços ao longo da barra.** O solver passa a guardar a força normal, a cortante e o momento em 41 seções, mais a reação de cada junta, até a soltura.
- **Verificação de cada peça** (`src/structure.ts`):
  - braço e perna: flexão com normal, e cisalhamento;
  - eixo: cisalhamento duplo, flexão do pino e esmagamento do furo, com a fórmula de Hankinson pelo ângulo da carga com as fibras;
  - pórtico: compressão, tração e flambagem de Euler das 4 pernas;
  - haste do contrapeso;
  - funda e cordas, com campo para a carga de ruptura do catálogo.
- **Dois critérios lado a lado.**
  - Ruptura: valores médios.
  - Projeto: NBR 7190 para madeira (k_mod 0,88, γ 1,4/1,8), NBR 8800 para aço, corda a 1/5 da ruptura, cargas × 1,4.
  - A ficha mostra o FS nos dois critérios, e uma tabela "Estrutura" no painel de física compara as peças.
- **Quebra.** O seletor ao lado de Disparar tem três posições: desligada (padrão), ruptura ou projeto. Ele fica salvo no design. Quando uma peça passa do limite:
  - o disparo para no instante da falha;
  - a peça fica vermelha no 2D e no 3D, com um anel onde a barra trincou;
  - o alcance vale 0 e um aviso dá a tensão contra a resistência.
  - Exemplo: no articulado padrão, o braço de 60 kg em eucalipto citriodora quebra em t = 0,73 s (σ 122 > 121 MPa). Em jatobá 6 × 16 cm ele aguenta na ruptura (FS 1,83), mas não no projeto (FS 0,31).
- **Otimizador sem quebrar.**
  - "As peças não podem quebrar" tem critério e FS mínimo, e penaliza designs que quebrariam.
  - "Varrer materiais" faz uma triagem de cada material × bitola e otimiza, em cada material, a bitola mais leve que aguenta e a logo abaixo. Com "Distribuir o braço" (o comprimento da peça disponível), sai um ranking com o botão Aplicar.
  - Exemplo: articulado com uma peça de 6,25 m, só madeiras, ruptura. O melhor resultado foi curupixá 6 × 16 cm (47 kg), com 270 m contra 225 m do padrão. Foram 270 combinações na triagem e 54 otimizadas, em 2 min no navegador.
- Fora desta versão: o trilho dos floating arms e a torre da polia do MURLIN (considerados apoiados), o pórtico em designs livres e os pedaços voando depois da quebra. A vista 3D verifica com as cargas do modelo plano, então a flexão lateral (pino fora do centro, vento) fica de fora.
- Testes novos: seções, N/V/M em forma fechada, razão entre os critérios, perna do cavalete contra Euler, quebra detectada no braço e otimizador parando no FS mínimo.

## 2026-10-18: ficha de peça (inspetor estilo BIM), 2D e 3D

- **Clique numa peça** no desenho 2D ou na vista 3D (clique sem arrastar) para abrir a ficha dela. A peça fica destacada nas duas vistas. O botão **Peças** abre a ficha pelo teclado, e a lista no topo da ficha alcança peças sem desenho próprio, como os pinos entre peças no 3D.
- **Tudo é selecionável:** braço, contrapeso, haste, projétil, perna, funda, cordas, eixo e pórtico, trilhos, guia, rolete, tambor, chão de pouso, molas, equipe e qualquer outra ligação.
- **Edição com recálculo.** Nos presets, os campos da ficha são os mesmos controles (mesmos limites e dicas), e cada edição refaz o disparo. No editor livre, a ficha substitui os campos do painel lateral (inclusive a inclinação 3D do pino), e as edições entram no Ctrl+Z.
- **Material, seção e verificações** (valores característicos típicos; uma checagem à mão, não uma norma):
  - **Barras** (madeira C24/D30/D40, alumínio 6061-T6, aço S235): seção b × h. A massa passa a ser ρ·b·h·L quando você mexe em material ou seção. Sem seção digitada, ela é estimada pela massa (quadrada) e o fator de segurança avisa isso. Na barra do eixo, σ = M/W com W = b·h²/6 e o pico de flexão do disparo.
    - Exemplo: o articulado padrão, com braço de 60 kg em carvalho, dá σ = 68,6 MPa contra 30 MPa (FS 0,44, falha). Com 20 × 35 cm, o braço pesa 280 kg, σ cai para 3,1 MPa, mas o alcance cai de 225 para 83 m.
  - **Cordas** (sisal, poliéster, nylon, cabo de aço, Dyneema): ruptura ≈ σᵤ·πd²/4 contra o pico de tração; "ok" a partir de FS 5, por causa dos nós.
  - **Eixo** (aço S235/S355): cisalhamento duplo τ = 4/3·(F/2)/(πr²) contra f_y/√3. O articulado padrão dá FS 26.
  - **Contrapeso e projétil:** material escolhido numa lista. No contrapeso ele define a densidade (mesma massa); no projétil, a massa para o raio dado.
- No editor livre, as verificações só usam um disparo do esboço como está agora. Depois de uma edição, a ficha pede um novo disparo.
- Material e seção ficam salvos com o design (presets) ou em cada peça do esboço, e passam pela sanitização na importação. "Converter para o editor livre" leva os materiais de braço, funda e eixo.
- No celular a ficha fica logo abaixo do desenho; no computador ela flutua no canto dele.
- Testes novos (`test/parts.test.ts`): toda peça dos 13 presets abre uma ficha; fórmulas conferidas com contas à mão; massa pela seção; clique 2D acha braço, contrapeso, projétil, funda e eixo em todos os presets; abrir uma ficha não grava material vazio; limite de FS das cordas.

## 2026-10-17: precisão do otimizador, barra 3D no celular, teclado no 3D

- **Impactos no instante certo (2D e 3D).** Quando um contato fecha no meio de um passo, a simulação volta ao instante do toque (interpolando no passo), aplica o impacto ali e completa o passo.
  - Erro com o passo de 2 ms do otimizador: F2K de 0,29% para 0,005%; whipper de 0,069% para 0,002%; King Arthur de 0,025% para 0,003%. O F2K voltou à tolerância estrita de 0,1% no teste.
  - O culpado foi achado comparando as trajetórias de 2 ms e 0,1 ms: elas só se separavam no pouso das rodas. As duas hipóteses anteriores (defasagem do atrito, suavização do sinal do atrito) estavam erradas; subdividir o passo não mudava nada e foi descartado.
  - A direção do atrito no pino e o lado carregado de um trilho de dois lados agora são recalculados dentro do passo quando mudam.
- **Barra 3D no celular:** abaixo de 800 px os controles 3D viram três grupos recolhíveis (Condições, Ações, Construir), com `aria-expanded`. No computador continua tudo em linha.
- **Teclado na vista 3D:**
  - Câmera: setas deslocam, Shift+setas giram, + e − aproximam, 0 recentraliza.
  - Nós (em Editar nós): N e Shift+N escolhem o nó; setas e PageUp/PageDown o movem (5 cm, Shift: 1 cm); Enter confirma; Esc solta.
  - Cada movimento anuncia o nó e as coordenadas.

## 2026-10-17: seis melhorias (dispersão, flexão, Aprenda 3D, exportação, atrito implícito, construção em 3D)

1. **Dispersão (3D).** O botão "Dispersão" dispara 40 vezes com pequenas variações (soltura ±1°, rajadas de 1,5 m/s, pino ±1 cm, semente fixa) em vários workers e mostra os pontos de queda com as elipses de 1σ e 2σ.
   - Exemplo: o articulado com vento de 3 m/s dá alcance 224,3 ± 2,7 m, lateral 2,7 ± 1,1 m e elipse 2σ de 10,8 × 4,6 m.
   - `scatterStats` testado em 20 mil pontos gaussianos sintéticos.
2. **Pico de flexão no braço (2D e 3D).** Novo card com o momento máximo até a soltura e onde ele ocorre (quase sempre no eixo; 21 kN·m no articulado).
   - O cálculo soma as reações das juntas e o peso e a inércia distribuídos do braço (d'Alembert).
   - Validado: balanço parado dá mgL/2 na raiz; barra articulada solta da horizontal dá mgL/27 a L/3 do pino; 3D = 2D em 1e-6 nos 13 tipos.
3. **Aprenda: seção 10, "Em três dimensões".** Explica a paridade 2D/3D, o solver 3D e a sua validação, o que tira o tiro do plano, a mira, a dispersão e a flexão (σ = M/W). Traz um gráfico calculado ao vivo do desvio × vento cruzado: 0,81 m por m/s; pino a 25 cm desloca a curva ~1,6 m; 1° de mira, ~3,9 m.
4. **Exportar a máquina** em glTF (.glb, metros) ou STL (milímetros), só as peças sólidas e sempre na pose armada.
5. **Atrito resolvido junto com as restrições (2D e 3D).** A força de atrito entra na coluna da junta (Ĵ = J + c·D), sem a normal defasada de um passo.
   - Validado: um bloco a 3 m/s com μ 0,3 para em v₀²/(2μg) nos dois solvers.
   - O erro de 0,29% do F2K com o passo de 2 ms do otimizador não vinha da defasagem: vem da suavização do sinal do atrito de rolamento quando o braço começa a deslizar (0,03% sem rolamento). Fica documentado.
6. **Construir no 3D (editor livre).** Barra, massa, projétil, contrapeso, pino, solda, corda e apagar num plano de trabalho z, com encaixe nos nós e na grade. Um esboço que ainda não compila aparece como peças soltas. Teste: um trebuchet montado clique a clique dispara, e no plano z = 0,5 m cai exatamente 0,5 m de lado.

## 2026-10-17: itens em aberto fechados (branch `feat/3d`)

- **Tambor espelhado:** novo campo `Cam.dir` (2D e 3D). O editor escolhe o sentido pelo lado para onde a corda sai (polia ou contrapeso). Um MURLIN espelhado agora derruba o contrapeso exatamente como o original (teste `camdir`).
- **Encaixe em barras diagonais (editor):** perto de uma barra, o ponto cai sobre ela em vez de no nó da grade (que deixava a junta "solta"). Um nó da grade que já esteja sobre a barra é mantido.
- **Walking arm com alças:** as alças ficam na pose real (inclinada) e cada uma ajusta um comprimento ou ângulo medido a partir do eixo: braço, braço curto, perna (comprimento e ângulo) e funda. Aplicar cada alça na própria posição devolve os parâmetros exatos.
- **Mira (3D):** a máquina inteira gira em torno da vertical. A conta é exata: o vento é girado para o referencial da máquina e o ponto de queda é girado de volta.
  - Campo "Mira (°)" e variável do otimizador (±15°); a vista 3D gira máquina e trajetória e mostra a linha do alvo.
  - Contra 5 m/s de vento lateral, que o pino sozinho não compensa, ~1° de mira zera o desvio.
- **Solver 3D num worker:** a página fica bloqueada 3 ms por tiro (antes, ~1 s no walking arm). Um tiro novo cancela o anterior.
- **Eixo de pino inclinado (3D):** inclinação e guinada por pino no editor livre, até ±45°. Uma guinada de ±2° desvia o tiro de forma simétrica.
- **Atrito estático:** checado em vez de modelado. Uma suavização de Coulomb 10× mais dura (0,01 → 0,001 m/s) muda o alcance de todos os presets em no máximo 0,019%.
- **Resistência ao rolamento:** novo parâmetro Crr (padrão 0,003) nos trilhos, guias, rolete e rodas do F2K, nos dois solvers. 2D e 3D seguem iguais (~1e-12).
  - Com Crr 0,005 o alcance cai 0,4–0,6%; com 0,02, até 4% (FAKA).
  - No F2K, o passo de 2 ms do otimizador erra 0,26% (carga defasada no rolete; 0,016% no passo da interface de 0,5 ms). A tolerância está documentada no teste.
- **Restituição:** novo parâmetro e (padrão 0, o baque validado), nos dois solvers.
  - Validação: uma bola largada de 1 m quica até e²·h com e = 0; 0,5; 0,8.
  - Só muda o whipper (+3,8% com e = 0,3) e o F2K (+0,7% com e = 0,6), e o campo só aparece nesses dois.

### Números de referência (presets padrão, Crr 0,003)

| Tipo | Alcance | η |
|---|---|---|
| fixed | 184 m | 56% |
| hinged | 225 m | 79% |
| floating | 258 m | 82% |
| traction | 217 m | 86% |
| whipper | 395 m | 73% |
| walking | 69 m | 71% |
| murlin | 313 m | 72% |
| wheel | 270 m | 94% |
| f2k | 295 m | 70% |
| fet | 257 m | 82% |
| ka | 377 m | 62% |
| faka | 498 m | 85% |
| spring | 229 m | 83% |

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
