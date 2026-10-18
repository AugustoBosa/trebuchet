# Materiais brasileiros, quebra estrutural e otimização com uma peça disponível

Aprovado em 2026-10-18. Estende a ficha de peça (`src/parts.ts`, commit 9049b3a).

## Objetivo
- Escolher material e seção de cada peça, com uma lista de materiais disponíveis no Brasil.
- Peças que passam da resistência **quebram**: a animação para no instante da falha, a peça fica vermelha e o alcance vale 0.
- Dois critérios alternáveis, com uma tabela que os compara.
- Otimizador: dado o comprimento de uma peça disponível, achar o melhor desenho sem quebrar. Pode varrer materiais e bitolas comerciais.

## Dados (`src/materials.ts`)
- **Madeiras:**
  - 25 espécies do IPT, tiradas do manual *Madeira: uso sustentável na construção civil* (IPT/SVMA/SindusCon-SP, 2009), com valores a 12–15 % de umidade: ρ aparente, fM, fc0, fv, E.
  - Ipê e Cumaru das fichas CIRAD Tropix (2023); Maçaranduba de uma ficha EN 408.
  - Lacunas preenchidas por proporção ficam marcadas como estimadas: fc0 seco do angelim-pedra, fM seco da sucupira e do curupixá.
- **Metais:** aço SAE 1020 (metalon), ASTM A36, SAE 1045, inox 304, alumínio 6063-T5 e 6061-T6.
- **Cordas:** carga de ruptura ≈ σᵤ·πd²/4, com campo opcional para a carga do catálogo.
- **Seções:**
  - formas: retângulo b×h, redonda Ø, tubo retangular b×h×t e tubo redondo Ø×t;
  - bitolas comerciais: sarrafo, caibro, vigota, viga, pontalete, roliço, metalon, tubo de aço e tubo de alumínio;
  - chaves antigas (c24, d30, d40, al, s235, s355) viram apelidos.

## Esforços (solver 2D)
- `rodLoads` estende `bendingPeak`: N, V e M em 41 seções de uma barra.
- Amostragem a cada `loadEvery` passos, até a soltura.
- Cada amostra também guarda q e a força vetorial de cada junta.
- A vista 3D usa as cargas de um disparo 2D da mesma máquina. Flexão lateral fica de fora (`ponytail:`).

## Verificação (`src/structure.ts`)
Utilização u = solicitação/resistência, por amostra.

| Peça | Verificação |
|---|---|
| Braço e perna (walking) | (\|N\|/A + \|M\|/W) contra fM ou fy; τ = k·V/A contra fv |
| Eixo | cisalhamento duplo; flexão do pino no vão (largura do braço + 2 cm); embutimento no furo do braço (madeira: Hankinson com fe0 = fc0 e fe90 = fc0/4; metal: 1,5·fy) |
| Pórtico | só em eixo de pino fixo ao chão; 2 cavaletes A com a geometria do desenho (pés a ±0,5·h); cada perna em compressão, flambagem de Euler ou tração (madeira: ft = fc0/0,77) |
| Haste do contrapeso | tração, ou compressão + Euler (comprimento = articulação) |
| Cordas (funda, ajuste, tambor) | tração de pico contra a ruptura |

Critérios:
- **Ruptura:** valores médios. Madeira na ruptura, metal no escoamento, corda na ruptura.
- **Projeto:**
  - todas as cargas × 1,4;
  - madeira pela NBR 7190:1997: k_mod = 1,1·1,0·0,8 = 0,88; f_k = 0,7·f_m; γ_w = 1,4 (cisalhamento: f_vk = 0,54·f_vm, γ = 1,8); flexão limitada pelo fc0 de cálculo; E_ef = k_mod·E;
  - aço pela NBR 8800 (γ_a1 = 1,10);
  - corda: ruptura ÷ 5.
- A falha é a primeira amostra com u > 1 no critério ativo. A tabela mostra o FS = 1/u_max das peças nos dois critérios.
- Peça sem material definido: braço e eixo usam o padrão de hoje (seção estimada pela massa, aço). Pórtico e haste só são verificados com material definido.
- Seleção "Quebra": desligada (padrão; presets como hoje) | ruptura | projeto. Fica salva no design.

## Interface
- A ficha ganha forma da seção, bitola comercial, FS nos dois critérios e o campo da carga de ruptura da corda.
- O painel de física ganha a tabela "Estrutura" com o FS de cada peça nos dois critérios.
- Na quebra:
  - a animação para em t_f, a peça falha fica vermelha (2D e 3D) e uma marca indica o ponto;
  - o alcance aparece como "0 m (quebrou)";
  - um aviso diz qual peça, onde, quando e a tensão contra a resistência.

## Otimizador
- `evaluate` com `structure = {spec, mode, fsMin}`:
  - a massa do braço é recalculada pela seção;
  - pontuação = valor se u·fsMin ≤ 1, senão valor·(u·fsMin)⁻⁸, uma penalidade íngreme e contínua;
  - a escolha final é re-simulada em precisão total.
- Modo "varrer materiais": uma otimização por material × bitola comercial da família, com o comprimento total fixo. O resultado é um ranking com material, seção, massa, alcance e FS, e cada linha tem o botão "aplicar".

## Fora desta versão
- Trilho dos floating arms (apoiado no chão).
- Torre da polia do MURLIN.
- Verificações do pórtico em designs livres. O braço livre segue a ficha atual.
- Fragmentos voando depois da quebra.

## Testes
- Propriedades das seções contra contas à mão.
- N, V e M de uma barra horizontal articulada liberada do repouso (forma fechada) e de uma barra pendurada.
- Assess: razão entre os critérios, detecção do instante da falha e a perna do cavalete em compressão contra Euler.
- Otimizador: resultado com FS ≥ fsMin; a varredura devolve o ranking.
