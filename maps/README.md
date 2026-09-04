# Repositório de Mapas RTS (Kingdom Wars)

Coloque aqui os seus arquivos .json de mapas!
O servidor e o menu do jogo escaneiam esta pasta automaticamente em tempo de execução.

### Formato esperado do arquivo de mapa (mapa.json):
`json
{
  id: meu_mapa,
  name: Nome Épico do Mapa,
  mapIndex: 0,
  tileset: floresta,
  tilesetName: Floresta e Planície,
  players: 2 - 4 Jogadores,
  suggestedPlayers: 2,
  size: 80 x 80,
  width: 80,
  height: 80,
  author: Seu Nome,
  description: Descrição detalhada do relevo, estratégia e pontos de emboscada.,
  preview: null,
  palette: {
    grass: #4a7c3f,
    tree: #2d5a1e,
    water: #2a5f8f,
    mountain: #6b6b6b,
    gold: #ffd700,
    path: #8b7355
  }
}
`

*Novos arquivos adicionados nesta pasta aparecem imediatamente ao clicar em 🔄 no menu do jogo.*
