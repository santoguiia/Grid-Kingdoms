import { CONFIG, TERRAIN } from './config.js';
import { UNIT_DEFS, BUILDING_DEFS } from './data.js';

/**
 * EditorRegistry - Descoberta e registro dinâmico de elementos do jogo para o Editor de Mapas.
 * Garante que novas unidades, edifícios, terrenos ou facções adicionados ao jogo
 * apareçam automaticamente nas paletas sem necessidade de reescrever o editor.
 */
export class EditorRegistry {
    constructor() {
        this.terrainPalette = this.buildTerrainPalette();
        this.entityBrushes = this.buildEntityBrushes();
        this.spawnBrushes = this.buildSpawnBrushes();
    }

    /**
     * Mapeia dinamicamente os terrenos disponíveis no TERRAIN enum
     */
    buildTerrainPalette() {
        const defaultVisuals = {
            [TERRAIN.GRASS]: { name: 'Grama', icon: '🌱', color: '#4a7c3f', description: 'Terreno básico transitável' },
            [TERRAIN.TREE]: { name: 'Árvores / Madeira', icon: '🌲', color: '#2d5a1e', description: 'Recurso de madeira coletável' },
            [TERRAIN.WATER]: { name: 'Água', icon: '🌊', color: '#2a5f8f', description: 'Obstáculo intransitável' },
            [TERRAIN.MOUNTAIN]: { name: 'Montanha / Rocha', icon: '⛰️', color: '#6b6b6b', description: 'Obstáculo intransitável' },
            [TERRAIN.GOLD_MINE]: { name: 'Mina de Ouro', icon: '🪙', color: '#ffd700', description: 'Mina de ouro para extração' },
            [TERRAIN.PATH]: { name: 'Estrada de Terra', icon: '🪨', color: '#8b7355', description: 'Caminho transitável rápido' }
        };

        const list = [];
        for (const [key, value] of Object.entries(TERRAIN)) {
            const vis = defaultVisuals[value] || {
                name: key.toLowerCase().replace('_', ' '),
                icon: '🟦',
                color: '#555555',
                description: `Terreno ${key}`
            };
            list.push({
                type: 'terrain',
                id: value,
                keyName: key,
                name: vis.name,
                icon: vis.icon,
                color: vis.color,
                description: vis.description
            });
        }
        return list;
    }

    /**
     * Extrai dinamicamente as facções disponíveis a partir de CONFIG.FACTION_COLORS
     */
    buildSpawnBrushes() {
        const spawns = [];
        const factionKeys = ['player', 'bot1', 'bot2', 'bot3'];
        const factionLabels = {
            player: { name: 'Jogador 1 (Azul / Principal)', icon: '👑', team: 1 },
            bot1: { name: 'Inimigo / Bot 1 (Vermelho)', icon: '⚔️', team: 2 },
            bot2: { name: 'Inimigo / Bot 2 (Verde)', icon: '🛡️', team: 2 },
            bot3: { name: 'Inimigo / Bot 3 (Roxo)', icon: '🏹', team: 2 }
        };

        for (const fKey of factionKeys) {
            const meta = factionLabels[fKey] || { name: `Spawn ${fKey}`, icon: '🚩', team: 2 };
            const color = CONFIG.FACTION_COLORS[fKey] || '#eab308';
            spawns.push({
                type: 'spawn',
                id: fKey,
                name: meta.name,
                icon: meta.icon,
                color: color,
                team: meta.team,
                description: `Base inicial e centro de comando para ${meta.name}`
            });
        }

        // Ponto de expansão neutro
        spawns.push({
            type: 'spawn',
            id: 'expansion',
            name: 'Ponto de Expansão (Mina & Floresta)',
            icon: '🏛️',
            color: '#d97706',
            team: 0,
            description: 'Local para criação de base avançada no mapa'
        });

        return spawns;
    }

    /**
     * Descobre automaticamente creeps neutros e unidades/edifícios especiais
     */
    buildEntityBrushes() {
        const entities = [];

        // 1. Unidades Neutras (Creeps)
        if (typeof UNIT_DEFS !== 'undefined') {
            for (const [key, def] of Object.entries(UNIT_DEFS)) {
                if (key.startsWith('CREEP_') || def.isNeutral) {
                    entities.push({
                        type: 'creep',
                        id: key,
                        name: def.name,
                        icon: def.icon || '🐺',
                        color: def.color || '#84cc16',
                        unitTypeKey: key,
                        health: def.health,
                        attack: def.attack,
                        description: `Mob neutro: ${def.name} (${def.health} HP)`
                    });
                }
            }
        }

        return entities;
    }

    /**
     * Validação modular de consistência de um mapa criado
     */
    validateMap(mapData) {
        const errors = [];
        const warnings = [];

        if (!mapData.name || mapData.name.trim().length === 0) {
            errors.push('O mapa precisa de um nome válido.');
        }

        if (!Array.isArray(mapData.grid) || mapData.grid.length < 20) {
            errors.push('A grade de terreno está vazia ou corrompida.');
        }

        // Spawns essenciais
        const spawns = mapData.spawns || [];
        const hasPlayer = spawns.some(s => s.faction === 'player' || s.id === 'player');
        if (!hasPlayer) {
            errors.push('É obrigatório adicionar ao menos 1 Spawn do Jogador 1 (Azul).');
        }

        const hasEnemy = spawns.some(s => s.faction !== 'player' && s.id !== 'expansion');
        if (!hasEnemy) {
            warnings.push('Aviso: Nenhum spawn inimigo definido. O jogo funcionará como modo treino de construção.');
        }

        // Quantidade de recursos no mapa
        let goldTiles = 0;
        let treeTiles = 0;
        if (Array.isArray(mapData.grid)) {
            for (const row of mapData.grid) {
                for (const t of row) {
                    if (t === TERRAIN.GOLD_MINE) goldTiles++;
                    if (t === TERRAIN.TREE) treeTiles++;
                }
            }
        }

        if (goldTiles === 0) {
            warnings.push('Aviso: Não há minas de ouro no mapa.');
        }
        if (treeTiles < 10) {
            warnings.push('Aviso: Poucas árvores no mapa para coleta de madeira.');
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Gera modelo em branco inicial
     */
    createNewMap(width = CONFIG.MAP_WIDTH || 80, height = CONFIG.MAP_HEIGHT || 80, tileset = 'floresta') {
        const grid = [];
        for (let y = 0; y < height; y++) {
            const row = [];
            for (let x = 0; x < width; x++) {
                // Montanhas nas bordas por padrão de segurança
                if (x < 4 || x >= width - 4 || y < 4 || y >= height - 4) {
                    row.push(TERRAIN.MOUNTAIN);
                } else {
                    row.push(TERRAIN.GRASS);
                }
            }
            grid.push(row);
        }

        return {
            version: 2,
            id: 'mapa_custom_' + Date.now().toString(36),
            name: 'Meu Novo Mapa',
            author: 'Criador do Reino',
            description: 'Mapa estratégico criado com o World Editor de Grid Kingdoms.',
            width: width,
            height: height,
            tileset: tileset,
            tilesetName: tileset === 'deserto' ? 'Deserto de Areia' : tileset === 'pantano' ? 'Pântano Sombrio' : 'Floresta & Planície',
            suggestedPlayers: 2,
            players: '2 Jogadores',
            grid: grid,
            spawns: [
                { x: 14, y: 14, faction: 'player', name: 'Base do Jogador 1' },
                { x: width - 15, y: height - 15, faction: 'bot1', name: 'Base Inimiga 1' }
            ],
            creeps: [
                { x: Math.floor(width / 2), y: Math.floor(height / 2), type: 'CREEP_GOLEM', count: 1 }
            ]
        };
    }
}

export const editorRegistry = new EditorRegistry();
