# Atualização do Dashboard de Compras

## Objetivo
Ajustar somente o Dashboard de Compras, mantendo intactas as regras atuais do Fluxo de Caixa e as demais abas.

## Alterações
1. **Indicadores principais**
   - Manter **Dotação total** como a soma das dotações dos três compradores no mês selecionado.
   - Trocar **Comprado total** por **A pagar total mês**.
   - Calcular **A pagar total mês** usando exclusivamente os lançamentos importados da planilha principal do Fluxo de Caixa no mês selecionado.
   - Recalcular **Saldo disponível** como Dotação total menos A pagar total mês.
   - Recalcular **Consumo geral** como A pagar total mês dividido pela Dotação total.

2. **Cores do consumo**
   - Exibir percentual e barra em verde até 100%.
   - Exibir percentual e barra em vermelho quando ultrapassar 100%.
   - Manter o percentual real acima de 100%; apenas a largura visual da barra ficará contida no espaço disponível.
   - Preservar a transição suave já existente.

3. **Acesso ao dashboard**
   - Remover somente a senha adicional da aba Dashboard de Compras.
   - Manter a proteção atual do Cadastro de Metas e do módulo Comprador.

4. **Evolução do mês por comprador**
   - Adicionar abaixo de **Atingimento mensal por comprador** um gráfico de linhas responsivo.
   - Usar os pagamentos importados em **Comprador → Importação Planilha**, agrupados por dia e comprador.
   - Mostrar uma linha distinta para Marcelo, Suellen e Maurício, legenda, dias do mês no eixo horizontal, valores em reais no eixo vertical e tooltip com os valores exatos.
   - Recalcular o gráfico sempre que o mês for alterado.

5. **Atualização automática**
   - Atualizar os indicadores quando a planilha principal do Fluxo de Caixa for importada.
   - Atualizar o painel por comprador e o gráfico quando a planilha do módulo Comprador for importada.
   - Manter a atualização periódica já existente como segurança adicional.

## Validação
- Conferir o dashboard aberto sem senha em desktop e celular.
- Testar a troca de mês e os estados verde, vermelho e acima de 100%.
- Confirmar os quatro indicadores, o painel mensal e o gráfico com dados persistidos.
- Confirmar que a importação principal e a importação por comprador atualizam apenas os respectivos dados.
- Verificar carregamento, erros de tela e compilação final.

## Detalhes técnicos
- Reutilizar a leitura compartilhada do Fluxo de Caixa para o total mensal, filtrando apenas registros de origem importada.
- Reutilizar a visão mensal persistida dos compradores para a tabela e o gráfico diário.
- Usar a biblioteca de gráficos já instalada no projeto, sem criar nova dependência.
- Atualizar a regra arquitetural do projeto para registrar que os indicadores consolidados combinam dotação persistida, fluxo principal importado e pagamentos importados por comprador conforme sua finalidade.
