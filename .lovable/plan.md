# Total mensal de pagamentos na Auditoria

## Objetivo
Adicionar, abaixo de “Comparação de importações”, o quadro “Total a pagar por mês”, sem alterar os demais quadros ou regras existentes.

## Implementação
- Calcular os totais a partir dos lançamentos da importação mais recente armazenada no histórico permanente.
- Agrupar pela data de vencimento e exibir Setembro/2026, Outubro/2026, Novembro/2026, Dezembro/2026, Janeiro/2027 e Fevereiro/2027.
- Exibir também o total específico de Setembro a Dezembro de 2026.
- Atualizar o cálculo automaticamente junto com a consulta da comparação, inclusive após novas importações.
- Manter a exibição de importações recentes limitada a 2 dias, sem apagar ou sobrescrever o histórico.

## Detalhes técnicos
- Ampliar o retorno da consulta histórica existente com os totais mensais da importação mais recente.
- Renderizar o novo quadro na coluna direita, imediatamente após “Comparação de importações”.
- Validar compilação e os estados carregado/vazio na Auditoria.
