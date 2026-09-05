import { CONFIG, TERRAIN } from './config.js';
import { gameState } from './state.js';
import { UNIT_DEFS } from './data.js';
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function getEntityPosition(entity) {
    if (entity.width && entity.height) {
        return {
            x: entity.x * CONFIG.TILE_SIZE + entity.width * CONFIG.TILE_SIZE / 2,
            y: entity.y * CONFIG.TILE_SIZE + entity.height * CONFIG.TILE_SIZE / 2,
        };
    }
    return { x: entity.x, y: entity.y };
}

function getEntityTeam(entity) {
    if (!entity) return 0;
    if (entity.isNeutral || entity.owner === 'neutral') return 0; // Neutro não tem time formal
    if (entity.team !== undefined && entity.team !== null) return entity.team;
    if (gameState.teams && gameState.teams[entity.owner] !== undefined) {
        return gameState.teams[entity.owner];
    }
    // Fallback legado: player = time 1, qualquer bot/enemy = time 2
    return entity.owner === 'player' || entity.owner === 'p0' ? 1 : 2;
}

function isEntityHostile(entityA, entityB) {
    if (!entityA || !entityB) return false;
    if (entityA === entityB) return false;
    if (entityA.health <= 0 || entityB.health <= 0) return false;

    // Neutro aggroed: se for neutro, hostil a qualquer não-neutro próximo
    if (entityA.isNeutral || entityA.owner === 'neutral') {
        return entityB.owner !== 'neutral';
    }
    if (entityB.isNeutral || entityB.owner === 'neutral') {
        // Jogadores e bots podem atacar creeps neutros
        return true;
    }

    const teamA = getEntityTeam(entityA);
    const teamB = getEntityTeam(entityB);
    return teamA !== teamB;
}


function isCollidingWithObstacle(x, y, radius, ignoreBuilding = null) {
    const mapPixelW = CONFIG.MAP_WIDTH * CONFIG.TILE_SIZE;
    const mapPixelH = CONFIG.MAP_HEIGHT * CONFIG.TILE_SIZE;

    // Limites do mapa
    if (x - radius < 0 || x + radius > mapPixelW || y - radius < 0 || y + radius > mapPixelH) {
        return true;
    }

    // Colisão com terreno (Água, Montanha, Árvores, Minas de Ouro)
    const minTileX = Math.max(0, Math.floor((x - radius) / CONFIG.TILE_SIZE));
    const maxTileX = Math.min(CONFIG.MAP_WIDTH - 1, Math.floor((x + radius) / CONFIG.TILE_SIZE));
    const minTileY = Math.max(0, Math.floor((y - radius) / CONFIG.TILE_SIZE));
    const maxTileY = Math.min(CONFIG.MAP_HEIGHT - 1, Math.floor((y + radius) / CONFIG.TILE_SIZE));

    for (let ty = minTileY; ty <= maxTileY; ty++) {
        for (let tx = minTileX; tx <= maxTileX; tx++) {
            const terrain = gameState.map[ty]?.[tx];
            if (terrain === TERRAIN.WATER || terrain === TERRAIN.MOUNTAIN || terrain === TERRAIN.TREE || terrain === TERRAIN.GOLD_MINE) {
                const tileX1 = tx * CONFIG.TILE_SIZE;
                const tileY1 = ty * CONFIG.TILE_SIZE;
                const tileX2 = tileX1 + CONFIG.TILE_SIZE;
                const tileY2 = tileY1 + CONFIG.TILE_SIZE;

                const closestX = Math.max(tileX1, Math.min(x, tileX2));
                const closestY = Math.max(tileY1, Math.min(y, tileY2));
                const dx = x - closestX;
                const dy = y - closestY;

                if (dx * dx + dy * dy < radius * radius) {
                    return true;
                }
            }
        }
    }

    // Colisão com edifícios
    if (gameState.buildings) {
        for (let i = 0; i < gameState.buildings.length; i++) {
            const b = gameState.buildings[i];
            if (b === ignoreBuilding || b.health <= 0) continue;
            const bx1 = b.x * CONFIG.TILE_SIZE;
            const by1 = b.y * CONFIG.TILE_SIZE;
            const bx2 = (b.x + b.width) * CONFIG.TILE_SIZE;
            const by2 = (b.y + b.height) * CONFIG.TILE_SIZE;

            const closestX = Math.max(bx1, Math.min(x, bx2));
            const closestY = Math.max(by1, Math.min(y, by2));
            const dx = x - closestX;
            const dy = y - closestY;

            if (dx * dx + dy * dy < radius * radius) {
                return true;
            }
        }
    }

    return false;
}

function getResourceCluster(startTileX, startTileY) {
    let terrainType = gameState.map[startTileY]?.[startTileX];
    if (terrainType !== TERRAIN.GOLD_MINE && terrainType !== TERRAIN.TREE) {
        // O bloco de origem pode ter sido esgotado e convertido em terreno livre.
        // Procura os blocos restantes do mesmo veio para manter a coleta contínua.
        for (let radius = 1; radius <= 3 && terrainType !== TERRAIN.GOLD_MINE && terrainType !== TERRAIN.TREE; radius++) {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const candidate = gameState.map[startTileY + dy]?.[startTileX + dx];
                    if (candidate === TERRAIN.GOLD_MINE || candidate === TERRAIN.TREE) {
                        terrainType = candidate;
                        startTileX += dx;
                        startTileY += dy;
                        break;
                    }
                }
                if (terrainType === TERRAIN.GOLD_MINE || terrainType === TERRAIN.TREE) break;
            }
        }
    }
    if (terrainType !== TERRAIN.GOLD_MINE && terrainType !== TERRAIN.TREE) {
        return null;
    }

    const visited = new Set();
    const cluster = [];
    const queue = [{ x: startTileX, y: startTileY }];
    visited.add(`${startTileX},${startTileY}`);

    let totalRemaining = 0;

    while (queue.length > 0 && cluster.length < 30) {
        const curr = queue.shift();
        const amt = gameState.resourceAmounts[curr.y]?.[curr.x] || 0;
        cluster.push({
            x: curr.x,
            y: curr.y,
            amount: amt,
            type: terrainType === TERRAIN.GOLD_MINE ? 'gold' : 'wood'
        });
        totalRemaining += amt;

        const dirs = [
            { dx: 1, dy: 0 },
            { dx: -1, dy: 0 },
            { dx: 0, dy: 1 },
            { dx: 0, dy: -1 },
            { dx: 1, dy: 1 },
            { dx: -1, dy: 1 },
            { dx: 1, dy: -1 },
            { dx: -1, dy: -1 },
        ];

        for (const dir of dirs) {
            const nx = curr.x + dir.dx;
            const ny = curr.y + dir.dy;
            const key = `${nx},${ny}`;
            if (nx >= 0 && nx < CONFIG.MAP_WIDTH && ny >= 0 && ny < CONFIG.MAP_HEIGHT && !visited.has(key)) {
                if (gameState.map[ny]?.[nx] === terrainType) {
                    visited.add(key);
                    queue.push({ x: nx, y: ny });
                }
            }
        }
    }

    const avgX = cluster.reduce((sum, t) => sum + t.x, 0) / cluster.length;
    const avgY = cluster.reduce((sum, t) => sum + t.y, 0) / cluster.length;

    return {
        type: terrainType === TERRAIN.GOLD_MINE ? 'gold' : 'wood',
        terrainType,
        tiles: cluster,
        totalRemaining,
        centerX: avgX,
        centerY: avgY,
        originTile: { x: startTileX, y: startTileY }
    };
}

function getStandPositionNearCluster(cluster, fromX, fromY, unitRadius = 8, unitIndex = 0) {
    if (!cluster || !cluster.tiles || cluster.tiles.length === 0) {
        return { x: fromX, y: fromY };
    }

    const half = CONFIG.TILE_SIZE / 2;
    const step = half + unitRadius + 3;
    const candidates = [];

    for (const tile of cluster.tiles) {
        const cx = tile.x * CONFIG.TILE_SIZE + half;
        const cy = tile.y * CONFIG.TILE_SIZE + half;

        const offsets = [
            { x: cx + step, y: cy },
            { x: cx - step, y: cy },
            { x: cx, y: cy + step },
            { x: cx, y: cy - step },
            { x: cx + step * 0.72, y: cy + step * 0.72 },
            { x: cx - step * 0.72, y: cy + step * 0.72 },
            { x: cx + step * 0.72, y: cy - step * 0.72 },
            { x: cx - step * 0.72, y: cy - step * 0.72 },
        ];

        for (const cand of offsets) {
            if (!isCollidingWithObstacle(cand.x, cand.y, unitRadius)) {
                const distFrom = Math.hypot(cand.x - fromX, cand.y - fromY);
                candidates.push({ ...cand, distFrom, tileX: tile.x, tileY: tile.y });
            }
        }
    }

    if (candidates.length > 0) {
        candidates.sort((a, b) => a.distFrom - b.distFrom);
        const chosen = candidates[unitIndex % candidates.length] || candidates[0];
        return chosen;
    }

    const clusterPixelX = (cluster.centerX * CONFIG.TILE_SIZE) + half;
    const clusterPixelY = (cluster.centerY * CONFIG.TILE_SIZE) + half;
    const angle = Math.atan2(fromY - clusterPixelY, fromX - clusterPixelX);
    const fallbackRadius = (Math.max(1, Math.sqrt(cluster.tiles.length)) * CONFIG.TILE_SIZE / 2) + unitRadius + 4;
    return {
        x: clusterPixelX + Math.cos(angle) * fallbackRadius,
        y: clusterPixelY + Math.sin(angle) * fallbackRadius,
        tileX: cluster.originTile.x,
        tileY: cluster.originTile.y
    };
}

function getStandPositionNearTile(tileX, tileY, fromX, fromY, unitRadius = 8) {
    const cluster = getResourceCluster(tileX, tileY);
    if (cluster && cluster.tiles.length > 0) {
        return getStandPositionNearCluster(cluster, fromX, fromY, unitRadius, 0);
    }

    const half = CONFIG.TILE_SIZE / 2;
    const centerX = tileX * CONFIG.TILE_SIZE + half;
    const centerY = tileY * CONFIG.TILE_SIZE + half;
    const step = half + unitRadius + 2;

    const candidates = [
        { x: centerX + step, y: centerY },
        { x: centerX - step, y: centerY },
        { x: centerX, y: centerY + step },
        { x: centerX, y: centerY - step },
        { x: centerX + step * 0.75, y: centerY + step * 0.75 },
        { x: centerX - step * 0.75, y: centerY + step * 0.75 },
        { x: centerX + step * 0.75, y: centerY - step * 0.75 },
        { x: centerX - step * 0.75, y: centerY - step * 0.75 },
    ];

    let best = null;
    let bestDist = Infinity;

    for (const cand of candidates) {
        if (!isCollidingWithObstacle(cand.x, cand.y, unitRadius)) {
            const d = Math.hypot(cand.x - fromX, cand.y - fromY);
            if (d < bestDist) {
                bestDist = d;
                best = cand;
            }
        }
    }

    if (best) return best;

    // Fallback em direção a fromX, fromY
    const angle = Math.atan2(fromY - centerY, fromX - centerX);
    return {
        x: centerX + Math.cos(angle) * step,
        y: centerY + Math.sin(angle) * step
    };
}

function getStandPositionNearBuilding(building, fromX, fromY, unitRadius = 8) {
    const bx = building.x * CONFIG.TILE_SIZE;
    const by = building.y * CONFIG.TILE_SIZE;
    const bw = building.width * CONFIG.TILE_SIZE;
    const bh = building.height * CONFIG.TILE_SIZE;
    const centerX = bx + bw / 2;
    const centerY = by + bh / 2;

    // Ponto mais próximo na borda do retângulo do edifício
    const clampX = Math.max(bx, Math.min(fromX, bx + bw));
    const clampY = Math.max(by, Math.min(fromY, by + bh));

    let dx = fromX - centerX;
    let dy = fromY - centerY;
    let dist = Math.hypot(dx, dy);
    if (dist < 0.001) {
        dx = 1;
        dy = 0;
        dist = 1;
    }

    const pad = unitRadius + 4;
    const candX = clampX + (dx / dist) * pad;
    const candY = clampY + (dy / dist) * pad;

    if (!isCollidingWithObstacle(candX, candY, unitRadius, building)) {
        return { x: candX, y: candY };
    }

    const sideCandidates = [
        { x: bx + bw / 2, y: by + bh + pad },
        { x: bx + bw / 2, y: by - pad },
        { x: bx + bw + pad, y: by + bh / 2 },
        { x: bx - pad, y: by + bh / 2 },
    ];

    let best = null;
    let bestDist = Infinity;
    for (const cand of sideCandidates) {
        if (!isCollidingWithObstacle(cand.x, cand.y, unitRadius, building)) {
            const d = Math.hypot(cand.x - fromX, cand.y - fromY);
            if (d < bestDist) {
                bestDist = d;
                best = cand;
            }
        }
    }

    return best || { x: candX, y: candY };
}

function isWalkableTile(tileX, tileY, radius, goalTile = null) {
    if (tileX < 0 || tileX >= CONFIG.MAP_WIDTH || tileY < 0 || tileY >= CONFIG.MAP_HEIGHT) return false;
    if (goalTile && tileX === goalTile.x && tileY === goalTile.y) {
        return !isCollidingWithObstacle(tileX * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2, tileY * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2, radius);
    }
    return !isCollidingWithObstacle(tileX * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2, tileY * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2, radius);
}

function findPath(startX, startY, targetX, targetY, radius = 8) {
    const start = {
        x: Math.max(0, Math.min(CONFIG.MAP_WIDTH - 1, Math.floor(startX / CONFIG.TILE_SIZE))),
        y: Math.max(0, Math.min(CONFIG.MAP_HEIGHT - 1, Math.floor(startY / CONFIG.TILE_SIZE)))
    };
    let goal = {
        x: Math.max(0, Math.min(CONFIG.MAP_WIDTH - 1, Math.floor(targetX / CONFIG.TILE_SIZE))),
        y: Math.max(0, Math.min(CONFIG.MAP_HEIGHT - 1, Math.floor(targetY / CONFIG.TILE_SIZE)))
    };
    if (!isWalkableTile(goal.x, goal.y, radius)) {
        let replacement = null;
        for (let distance = 1; distance <= 5 && !replacement; distance++) {
            for (let dy = -distance; dy <= distance && !replacement; dy++) {
                for (let dx = -distance; dx <= distance; dx++) {
                    if (Math.abs(dx) !== distance && Math.abs(dy) !== distance) continue;
                    const candidate = { x: goal.x + dx, y: goal.y + dy };
                    if (isWalkableTile(candidate.x, candidate.y, radius)) {
                        replacement = candidate;
                        break;
                    }
                }
            }
        }
        if (replacement) goal = replacement;
    }
    if (start.x === goal.x && start.y === goal.y) return [];

    const goalKey = `${goal.x},${goal.y}`;
    const open = [{ x: start.x, y: start.y, g: 0, f: 0, parent: null }];
    const nodes = new Map([[`${start.x},${start.y}`, open[0]]]);
    const closed = new Set();
    const directions = [
        { x: 1, y: 0, cost: 1 }, { x: -1, y: 0, cost: 1 },
        { x: 0, y: 1, cost: 1 }, { x: 0, y: -1, cost: 1 },
        { x: 1, y: 1, cost: 1.414 }, { x: -1, y: 1, cost: 1.414 },
        { x: 1, y: -1, cost: 1.414 }, { x: -1, y: -1, cost: 1.414 }
    ];
    const heuristic = (x, y) => Math.hypot(goal.x - x, goal.y - y);
    let current = null;
    let iterations = 0;

    while (open.length > 0 && iterations++ < 2600) {
        open.sort((a, b) => a.f - b.f);
        current = open.shift();
        const currentKey = `${current.x},${current.y}`;
        if (currentKey === goalKey) break;
        if (closed.has(currentKey)) continue;
        closed.add(currentKey);

        for (const direction of directions) {
            const nx = current.x + direction.x;
            const ny = current.y + direction.y;
            const key = `${nx},${ny}`;
            if (closed.has(key) || !isWalkableTile(nx, ny, radius, goal)) continue;
            if (direction.x !== 0 && direction.y !== 0 &&
                (!isWalkableTile(current.x + direction.x, current.y, radius) ||
                 !isWalkableTile(current.x, current.y + direction.y, radius))) continue;

            const g = current.g + direction.cost;
            const existing = nodes.get(key);
            if (existing && existing.g <= g) continue;
            const node = { x: nx, y: ny, g, f: g + heuristic(nx, ny), parent: current };
            nodes.set(key, node);
            open.push(node);
        }
    }

    if (!current || `${current.x},${current.y}` !== goalKey) return null;
    const path = [];
    while (current && !(current.x === start.x && current.y === start.y)) {
        path.push({
            x: current.x * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
            y: current.y * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2
        });
        current = current.parent;
    }
    return path.reverse();
}

function moveUnitWithCollision(unit, vx, vy) {
    const radius = unit.size || 8;
    const targetX = unit.x + vx;
    const targetY = unit.y + vy;

    // Movimento direto
    if (!isCollidingWithObstacle(targetX, targetY, radius)) {
        unit.x = targetX;
        unit.y = targetY;
        return true;
    }

    // Deslizar no eixo X
    let moved = false;
    if (Math.abs(vx) > 0.001 && !isCollidingWithObstacle(unit.x + vx, unit.y, radius)) {
        unit.x += vx;
        moved = true;
    }

    // Deslizar no eixo Y
    if (Math.abs(vy) > 0.001 && !isCollidingWithObstacle(unit.x, unit.y + vy, radius)) {
        unit.y += vy;
        moved = true;
    }

    return moved;
}

function resolveUnitCollisions() {
    const units = gameState.units;
    const len = units.length;
    if (len < 2) return;

    for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < len; i++) {
            const u1 = units[i];
            if (u1.health <= 0) continue;
            const r1 = u1.size || 8;

            for (let j = i + 1; j < len; j++) {
                const u2 = units[j];
                if (u2.health <= 0) continue;
                const r2 = u2.size || 8;
                const minDist = r1 + r2;

                let dx = u2.x - u1.x;
                let dy = u2.y - u1.y;
                let distSq = dx * dx + dy * dy;

                if (distSq < minDist * minDist) {
                    let dist = Math.sqrt(distSq);
                    if (dist < 0.001) {
                        dx = (Math.random() - 0.5) || 0.1;
                        dy = (Math.random() - 0.5) || 0.1;
                        dist = Math.hypot(dx, dy);
                    }

                    const overlap = minDist - dist;
                    const nx = dx / dist;
                    const ny = dy / dist;

                    const push1 = overlap * 0.5;
                    const push2 = overlap * 0.5;

                    const nx1 = u1.x - nx * push1;
                    const ny1 = u1.y - ny * push1;
                    if (!isCollidingWithObstacle(nx1, ny1, r1)) {
                        u1.x = nx1;
                        u1.y = ny1;
                    } else if (!isCollidingWithObstacle(nx1, u1.y, r1)) {
                        u1.x = nx1;
                    } else if (!isCollidingWithObstacle(u1.x, ny1, r1)) {
                        u1.y = ny1;
                    }

                    const nx2 = u2.x + nx * push2;
                    const ny2 = u2.y + ny * push2;
                    if (!isCollidingWithObstacle(nx2, ny2, r2)) {
                        u2.x = nx2;
                        u2.y = ny2;
                    } else if (!isCollidingWithObstacle(nx2, u2.y, r2)) {
                        u2.x = nx2;
                    } else if (!isCollidingWithObstacle(u2.x, ny2, r2)) {
                        u2.y = ny2;
                    }
                }
            }
        }
    }

    // Desatolar automaticamente qualquer unidade que por ventura esteja sobreposta a um edifício
    if (gameState.buildings) {
        for (const u of units) {
            if (u.health <= 0) continue;
            const uRad = u.size || 8;
            for (const b of gameState.buildings) {
                if (b.health <= 0) continue;
                const bx1 = b.x * CONFIG.TILE_SIZE;
                const by1 = b.y * CONFIG.TILE_SIZE;
                const bx2 = (b.x + b.width) * CONFIG.TILE_SIZE;
                const by2 = (b.y + b.height) * CONFIG.TILE_SIZE;

                // Se a unidade está dentro do retângulo do prédio
                if (u.x >= bx1 - uRad * 0.5 && u.x <= bx2 + uRad * 0.5 &&
                    u.y >= by1 - uRad * 0.5 && u.y <= by2 + uRad * 0.5) {
                    const safe = getStandPositionNearBuilding(b, u.x, u.y, uRad);
                    u.x = safe.x;
                    u.y = safe.y;
                }
            }
        }
    }
}

function assignFormationPositions(units, targetX, targetY) {
    const count = units.length;
    if (count === 0) return;
    if (count === 1) {
        const u = units[0];
        u.targetX = targetX;
        u.targetY = targetY;
        u.path = findPath(u.x, u.y, targetX, targetY, u.size || 8);
        u.pathIndex = 0;
        u.pathGoal = { x: targetX, y: targetY };
        u.attackTarget = null;
        u.gathering = false;
        u.autoGathering = false;
        u.returning = false;
        u.clusterOrigin = null;
        u.gatherType = null;
        u.gatherTargetTile = null;
        u.buildingTarget = null;
        u.isBuilding = false;
        u.repairTarget = null;
        u.isRepairing = false;
        return;
    }

    const spacing = 24;
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);

    units.forEach((unit, index) => {
        const col = (index % cols) - (cols - 1) / 2;
        const row = Math.floor(index / cols) - (rows - 1) / 2;

        let candX = targetX + col * spacing;
        let candY = targetY + row * spacing;

        if (isCollidingWithObstacle(candX, candY, unit.size || 8)) {
            if (!isCollidingWithObstacle(targetX, targetY, unit.size || 8)) {
                candX = targetX;
                candY = targetY;
            }
        }

        unit.targetX = candX;
        unit.targetY = candY;
        unit.path = findPath(unit.x, unit.y, candX, candY, unit.size || 8);
        unit.pathIndex = 0;
        unit.pathGoal = { x: candX, y: candY };
        unit.attackTarget = null;
        unit.gathering = false;
        unit.autoGathering = false;
        unit.returning = false;
        unit.clusterOrigin = null;
        unit.gatherType = null;
        unit.gatherTargetTile = null;
        unit.buildingTarget = null;
        unit.isBuilding = false;
        unit.repairTarget = null;
        unit.isRepairing = false;
    });
}

class Unit {
    constructor(type, x, y, owner, customId = null) {
        this.type = type;
        this.health = type.health ?? type.hp ?? 100;
        this.maxHealth = type.maxHealth ?? type.health ?? type.hp ?? 100;
        this.speed = type.speed || 1.5;
        this.attack = type.attack || 0;
        this.attackRange = type.attackRange || 0;
        this.attackCooldown = type.attackCooldown || 60;
        this.color = type.color;
        this.size = type.size || 8;
        this.icon = type.icon || '👤';
        this.name = type.name || 'Unidade';
        this.canGather = type.canGather || false;
        this.canAttack = type.canAttack || false;
        this.isEnemy = owner === 'enemy' || owner.startsWith('bot') || (owner !== 'player' && owner !== 'neutral');
        this.isNeutral = owner === 'neutral';
        this.owner = owner;
        this.team = getEntityTeam({ owner, isNeutral: this.isNeutral });
        this.isHero = Boolean(type.isHero);
        this.xpReward = type.xpReward || 0;
        this.goldReward = type.goldReward || 0;
        this.homeX = x;
        this.homeY = y;
        this.aggroRange = this.isNeutral ? 130 : (this.attackRange || 25);
        this.chaseTimer = 0;
        this.maxChaseDuration = 240; // ~4 segundos (60 ticks/s) perseguindo antes de desengajar
        this.returningHome = false;
        this.heroHealTimer = 0;

        
        this.x = x;
        this.y = y;
        this.targetX = null;
        this.targetY = null;
        this.attackTarget = null;
        this.cooldown = 0;
        this.gathering = false;
        this.gatherType = null; // 'gold' ou 'wood'
        this.gatherTargetTile = null;
        this.gatherAmount = 0;
        this.maxGather = type.gatherAmount || CONFIG.PEASANT_CARRY_CAPACITY;
        if (owner === 'player' && gameState.researchedTechs?.includes('WHEELBARROW') && this.canGather) {
            this.maxGather = Math.ceil(this.maxGather * 1.5);
        }
        if (owner === 'player' && gameState.researchedTechs?.includes('LOOM') && this.canGather) {
            this.maxHealth = Math.round(this.maxHealth * 1.25);
            this.health = this.maxHealth;
        }
        if (owner === 'player' && gameState.researchedTechs?.includes('IRON_WORKING') && this.canAttack && !this.canGather) {
            this.attack = Math.ceil(this.attack * 1.15);
        }
        this.returning = false;
        this.gatherTimer = 0;
        this.autoGathering = false;
        this.clusterOrigin = null;
        this.buildingTarget = null;
        this.isBuilding = false;
        this.repairTarget = null;
        this.isRepairing = false;
        this.buildTimer = 0;
        this.path = null;
        this.pathIndex = 0;
        this.pathGoal = null;
        this.id = customId || Math.random().toString(36).substr(2, 9);
    }

    assignBuild(building) {
        if (!building || building.health <= 0) return false;
        this.buildingTarget = building;
        this.isBuilding = false;
        this.repairTarget = null;
        this.isRepairing = false;
        this.buildTimer = 0;
        this.attackTarget = null;
        this.gathering = false;
        this.autoGathering = false;
        this.returning = false;
        this.clusterOrigin = null;
        this.gatherType = null;
        this.gatherTargetTile = null;

        const standPos = getStandPositionNearBuilding(building, this.x, this.y, this.size);
        this.targetX = standPos.x;
        this.targetY = standPos.y;
        this.stuckFrames = 0;
        return true;
    }

    assignRepair(building) {
        if (!building || building.health <= 0 || building.health >= building.maxHealth) return false;
        this.repairTarget = building;
        this.isRepairing = false;
        this.buildingTarget = null;
        this.isBuilding = false;
        this.buildTimer = 0;
        this.attackTarget = null;
        this.gathering = false;
        this.autoGathering = false;
        this.returning = false;
        this.clusterOrigin = null;
        this.gatherType = null;
        this.gatherTargetTile = null;

        const standPos = getStandPositionNearBuilding(building, this.x, this.y, this.size);
        this.targetX = standPos.x;
        this.targetY = standPos.y;
        this.stuckFrames = 0;
        return true;
    }

    assignResourceHarvest(tileX, tileY, unitIndex = 0) {
        const cluster = getResourceCluster(tileX, tileY);
        if (!cluster || cluster.totalRemaining <= 0) {
            this.gathering = false;
            this.autoGathering = false;
            this.clusterOrigin = null;
            return false;
        }

        this.buildingTarget = null;
        this.isBuilding = false;
        this.repairTarget = null;
        this.isRepairing = false;
        const standPos = getStandPositionNearCluster(cluster, this.x, this.y, this.size, unitIndex);
        this.targetX = standPos.x;
        this.targetY = standPos.y;
        this.gathering = true;
        this.returning = false;
        this.gatherType = cluster.type;
        this.gatherTargetTile = { x: standPos.tileX ?? tileX, y: standPos.tileY ?? tileY };
        this.clusterOrigin = { x: cluster.originTile.x, y: cluster.originTile.y, type: cluster.type };
        this.autoGathering = true;
        this.gatherTimer = 0;
        this.attackTarget = null;
        this.stuckFrames = 0;
        return true;
    }
    
    update() {
        if (this.cooldown > 0) this.cooldown--;

        // Aura sagrada do Herói: cura periódica para si e aliados próximos
        if (this.isHero && this.health > 0) {
            this.heroHealTimer = (this.heroHealTimer || 0) + 1;
            if (this.heroHealTimer >= 180) { // A cada ~3 segundos
                this.heroHealTimer = 0;
                const healRadius = 140;
                const allies = gameState.units.filter(u => u.owner === this.owner && u.health > 0 && u.health < u.maxHealth);
                for (const ally of allies) {
                    if (Math.hypot(ally.x - this.x, ally.y - this.y) <= healRadius) {
                        const healAmt = CONFIG.HERO_HEAL_BASE + (gameState.heroLevel || 1) * CONFIG.HERO_HEAL_PER_LEVEL;
                        ally.health = Math.min(ally.maxHealth, ally.health + healAmt);
                        // Partículas de cura
                        for (let i = 0; i < 3; i++) {
                            gameState.particles.push({
                                x: ally.x + (Math.random() - 0.5) * 10,
                                y: ally.y - ally.size,
                                vx: (Math.random() - 0.5) * 1.5,
                                vy: -Math.random() * 2 - 0.5,
                                life: 18,
                                maxLife: 18,
                                color: '#4ade80',
                                size: 2.5
                            });
                        }
                    }
                }
            }
        }

        // Construção ativa de edifícios
        if (this.buildingTarget) {
            const building = this.buildingTarget;
            if (building.health <= 0 || !gameState.buildings.includes(building)) {
                this.buildingTarget = null;
                this.isBuilding = false;
            } else if (building.isConstructed) {
                this.buildingTarget = null;
                this.isBuilding = false;
                if (this.owner === 'enemy') {
                    this.autoGathering = true;
                    this.findResource();
                }
            } else {
                const bx = building.x * CONFIG.TILE_SIZE;
                const by = building.y * CONFIG.TILE_SIZE;
                const bw = building.width * CONFIG.TILE_SIZE;
                const bh = building.height * CONFIG.TILE_SIZE;
                const clampX = Math.max(bx, Math.min(this.x, bx + bw));
                const clampY = Math.max(by, Math.min(this.y, by + bh));
                const distToB = Math.hypot(this.x - clampX, this.y - clampY);

                if (distToB <= this.size + 14) {
                    this.targetX = null;
                    this.targetY = null;
                    this.isBuilding = true;
                    this.buildTimer = (this.buildTimer || 0) + 1;
                    
                    const finished = building.progressBuild(CONFIG.BUILD_SPEED);

                    // Efeito de martelo e partículas de construção
                    if (this.buildTimer % 16 === 0) {
                        gameState.particles.push({
                            x: (this.x + clampX) / 2 + (Math.random() - 0.5) * 6,
                            y: (this.y + clampY) / 2 + (Math.random() - 0.5) * 6,
                            vx: (Math.random() - 0.5) * 2,
                            vy: -Math.random() * 2 - 0.5,
                            life: 14,
                            maxLife: 14,
                            color: '#e0a96d',
                            size: 2.5
                        });
                    }

                    if (finished) {
                        this.buildingTarget = null;
                        this.isBuilding = false;
                        if (this.owner === 'enemy') {
                            this.autoGathering = true;
                            this.findResource();
                        }
                    }
                }
            }
        }

        // Reparo ativo de edifícios danificados
        if (this.repairTarget) {
            const building = this.repairTarget;
            if (building.health <= 0 || !gameState.buildings.includes(building)) {
                this.repairTarget = null;
                this.isRepairing = false;
            } else if (building.health >= building.maxHealth) {
                this.repairTarget = null;
                this.isRepairing = false;
                building.health = building.maxHealth;

                // Partículas comemorativas de reparo concluído
                const cx = (building.x + building.width / 2) * CONFIG.TILE_SIZE;
                const cy = (building.y + building.height / 2) * CONFIG.TILE_SIZE;
                for (let i = 0; i < 14; i++) {
                    gameState.particles.push({
                        x: cx + (Math.random() - 0.5) * building.width * CONFIG.TILE_SIZE,
                        y: cy + (Math.random() - 0.5) * building.height * CONFIG.TILE_SIZE,
                        vx: (Math.random() - 0.5) * 3,
                        vy: (Math.random() - 0.5) * 3 - 1,
                        life: 25,
                        maxLife: 25,
                        color: '#60a5fa',
                        size: 3
                    });
                }
                if (this.owner === 'enemy') {
                    this.autoGathering = true;
                    this.findResource();
                }
            } else {
                const bx = building.x * CONFIG.TILE_SIZE;
                const by = building.y * CONFIG.TILE_SIZE;
                const bw = building.width * CONFIG.TILE_SIZE;
                const bh = building.height * CONFIG.TILE_SIZE;
                const clampX = Math.max(bx, Math.min(this.x, bx + bw));
                const clampY = Math.max(by, Math.min(this.y, by + bh));
                const distToB = Math.hypot(this.x - clampX, this.y - clampY);

                if (distToB <= this.size + 14) {
                    this.targetX = null;
                    this.targetY = null;
                    this.isRepairing = true;
                    this.buildTimer = (this.buildTimer || 0) + 1;

                    // Taxa de reparo gradual
                    const repairRate = Math.max(0.4, building.maxHealth / 450);
                    building.health = Math.min(building.maxHealth, building.health + repairRate);

                    // Efeito de faíscas de ferramentas e martelamento
                    if (this.buildTimer % 14 === 0) {
                        gameState.particles.push({
                            x: (this.x + clampX) / 2 + (Math.random() - 0.5) * 8,
                            y: (this.y + clampY) / 2 + (Math.random() - 0.5) * 8,
                            vx: (Math.random() - 0.5) * 2.5,
                            vy: -Math.random() * 2 - 0.5,
                            life: 16,
                            maxLife: 16,
                            color: Math.random() > 0.5 ? '#60a5fa' : '#f59e0b',
                            size: 2.5
                        });
                    }

                    if (building.health >= building.maxHealth) {
                        building.health = building.maxHealth;
                        this.repairTarget = null;
                        this.isRepairing = false;
                        if (this.owner === 'enemy') {
                            this.autoGathering = true;
                            this.findResource();
                        }
                    }
                }
            }
        }
        
        // Movimento e navegação
        this.updateMovement();

        // Temporizador de coleta
        if (this.gathering && !this.returning && this.gatherTimer > 0) {
            this.gatherTimer--;

            // Partículas de extração periódicas
            if (this.gatherTimer % 22 === 0) {
                const particleColor = this.gatherType === 'gold' ? '#ffd700' : '#8b5a2b';
                gameState.particles.push({
                    x: this.x + (Math.random() - 0.5) * 8,
                    y: this.y + (Math.random() - 0.5) * 8,
                    vx: (Math.random() - 0.5) * 2,
                    vy: -Math.random() * 2 - 0.5,
                    life: 16,
                    maxLife: 16,
                    color: particleColor,
                    size: 2,
                });
            }

            if (this.gatherTimer === 0) {
                let tileX = this.gatherTargetTile ? this.gatherTargetTile.x : Math.floor(this.x / CONFIG.TILE_SIZE);
                let tileY = this.gatherTargetTile ? this.gatherTargetTile.y : Math.floor(this.y / CONFIG.TILE_SIZE);

                // Se o tile atual esgotou, procurar outro tile no mesmo cluster
                if ((gameState.resourceAmounts[tileY]?.[tileX] || 0) <= 0 && this.clusterOrigin) {
                    const cluster = getResourceCluster(this.clusterOrigin.x, this.clusterOrigin.y);
                    if (cluster) {
                        const validTile = cluster.tiles.find(t => (gameState.resourceAmounts[t.y]?.[t.x] || 0) > 0);
                        if (validTile) {
                            tileX = validTile.x;
                            tileY = validTile.y;
                            this.gatherTargetTile = { x: tileX, y: tileY };
                        }
                    }
                }

                const available = gameState.resourceAmounts[tileY]?.[tileX] || 0;
                this.gatherAmount = Math.min(this.maxGather, available);
                if (this.gatherAmount > 0) {
                    gameState.resourceAmounts[tileY][tileX] -= this.gatherAmount;
                    if (gameState.resourceAmounts[tileY][tileX] <= 0) {
                        if (this.gatherType === 'wood' || this.gatherType === 'gold') {
                            gameState.map[tileY][tileX] = TERRAIN.GRASS;
                        }
                    }
                    if (gameState.resourceDiffs) {
                        gameState.resourceDiffs.push({
                            x: tileX,
                            y: tileY,
                            amt: gameState.resourceAmounts[tileY][tileX],
                            t: gameState.map[tileY][tileX]
                        });
                    }
                    this.returning = true;
                    const base = this.findBase();
                    if (base) {
                        const standPos = getStandPositionNearBuilding(base, this.x, this.y, this.size);
                        this.targetX = standPos.x;
                        this.targetY = standPos.y;
                    }
                } else {
                    // Se o cluster atual esgotou
                    if (this.clusterOrigin) {
                        const cluster = getResourceCluster(this.clusterOrigin.x, this.clusterOrigin.y);
                        if (!cluster || cluster.totalRemaining <= 0) {
                            this.gathering = false;
                            this.autoGathering = false;
                            this.clusterOrigin = null;
                            this.gatherTargetTile = null;
                        } else {
                            this.assignResourceHarvest(cluster.originTile.x, cluster.originTile.y);
                        }
                    } else {
                        this.gathering = false;
                        this.autoGathering = false;
                    }
                }
            }
        }

        if (this.canGather && this.autoGathering && !this.gathering && !this.returning) {
            if (this.clusterOrigin) {
                const cluster = getResourceCluster(this.clusterOrigin.x, this.clusterOrigin.y);
                if (cluster && cluster.totalRemaining > 0) {
                    this.assignResourceHarvest(this.clusterOrigin.x, this.clusterOrigin.y);
                } else {
                    this.clusterOrigin = null;
                    this.findResource(this.gatherType);
                }
            } else {
                this.findResource();
            }
        }
        
        // Comportamento de IA e perseguição para Creeps Neutros
        if (this.isNeutral) {
            const distFromHome = Math.hypot(this.x - this.homeX, this.y - this.homeY);

            // Se estiver retornando para casa
            if (this.returningHome) {
                this.attackTarget = null;
                this.targetX = this.homeX;
                this.targetY = this.homeY;
                if (distFromHome <= 12) {
                    this.returningHome = false;
                    this.chaseTimer = 0;
                    this.targetX = null;
                    this.targetY = null;
                }
            } else {
                // Verificar ou encontrar alvo
                if (!this.attackTarget || this.attackTarget.health <= 0) {
                    this.attackTarget = this.findNearestEnemy();
                }

                if (this.attackTarget) {
                    const distToTarget = this.getDistanceTo(this.attackTarget);
                    const distTargetFromHome = Math.hypot(this.attackTarget.x - this.homeX, this.attackTarget.y - this.homeY);

                    // Desengajar se:
                    // 1) Perseguiu por mais tempo que maxChaseDuration (~4s)
                    // 2) Alvo se afastou muito do território de spawn (> 200px)
                    // 3) Alvo está muito longe do próprio mob (> 220px)
                    this.chaseTimer = (this.chaseTimer || 0) + 1;
                    if (this.chaseTimer > this.maxChaseDuration || distFromHome > 200 || distTargetFromHome > 220 || distToTarget > 220) {
                        this.attackTarget = null;
                        this.returningHome = true;
                        this.targetX = this.homeX;
                        this.targetY = this.homeY;
                    } else {
                        // Perseguir o alvo para atacá-lo se não estiver em alcance de ataque
                        if (distToTarget > this.attackRange * 0.8) {
                            this.targetX = this.attackTarget.x;
                            this.targetY = this.attackTarget.y;
                        } else {
                            // Dentro do alcance de ataque, para para golpear
                            this.targetX = null;
                            this.targetY = null;
                        }
                    }
                } else {
                    // Sem alvo e longe de casa: voltar gradualmente para home
                    this.chaseTimer = 0;
                    if (distFromHome > 15 && this.targetX === null) {
                        this.targetX = this.homeX;
                        this.targetY = this.homeY;
                    }
                }
            }
        }

        // Ataque automático
        if (this.canAttack && this.cooldown <= 0) {
            const target = this.attackTarget?.health > 0 ? this.attackTarget : this.findNearestEnemy();
            if (target && this.getDistanceTo(target) <= this.attackRange) {
                this.attackUnit(target);
            }
        }
    }

    updateMovement() {
        if (this.targetX !== null && this.targetY !== null) {
            const requestedTargetX = this.targetX;
            const requestedTargetY = this.targetY;
            const goalChanged = !this.pathGoal ||
                Math.hypot(this.pathGoal.x - requestedTargetX, this.pathGoal.y - requestedTargetY) > CONFIG.TILE_SIZE * 0.5;
            if (goalChanged) {
                this.path = null;
                this.pathIndex = 0;
                this.pathGoal = { x: requestedTargetX, y: requestedTargetY };
            }

            let moveTargetX = requestedTargetX;
            let moveTargetY = requestedTargetY;
            if (this.path && this.pathIndex < this.path.length) {
                const waypoint = this.path[this.pathIndex];
                if (Math.hypot(waypoint.x - this.x, waypoint.y - this.y) <= CONFIG.TILE_SIZE * 0.3) {
                    this.pathIndex++;
                }
                if (this.pathIndex < this.path.length) {
                    moveTargetX = this.path[this.pathIndex].x;
                    moveTargetY = this.path[this.pathIndex].y;
                }
            }

            const dx = moveTargetX - this.x;
            const dy = moveTargetY - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            let reachedTarget = false;
            if (this.gathering && !this.returning) {
                let inRange = false;
                if (this.clusterOrigin) {
                    const cluster = getResourceCluster(this.clusterOrigin.x, this.clusterOrigin.y);
                    const targetTile = this.gatherTargetTile;
                    if (cluster && targetTile && (gameState.resourceAmounts[targetTile.y]?.[targetTile.x] || 0) > 0) {
                        const tcX = targetTile.x * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
                        const tcY = targetTile.y * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
                        if (Math.hypot(tcX - this.x, tcY - this.y) <= CONFIG.TILE_SIZE * 1.35) {
                            inRange = true;
                        }
                    }
                } else if (this.gatherTargetTile) {
                    const targetTileCenter = {
                        x: this.gatherTargetTile.x * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
                        y: this.gatherTargetTile.y * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2
                    };
                    if (Math.hypot(targetTileCenter.x - this.x, targetTileCenter.y - this.y) <= CONFIG.TILE_SIZE * 1.35) {
                        inRange = true;
                    }
                }

                if (inRange || dist <= 6) {
                    reachedTarget = true;
                    this.targetX = null;
                    this.targetY = null;
                    if (this.gatherTimer <= 0) {
                        this.gatherTimer = CONFIG.GATHER_TIME;
                    }
                }
            } else if (this.returning) {
                const base = this.findBase();
                if (base) {
                    const baseCenter = getEntityPosition(base);
                    const distToBase = Math.hypot(baseCenter.x - this.x, baseCenter.y - this.y);
                    const baseRadius = Math.max(base.width, base.height) * CONFIG.TILE_SIZE * 0.8;
                    if (distToBase <= baseRadius) {
                        reachedTarget = true;
                        this.targetX = null;
                        this.targetY = null;
                        this.path = null;
                        this.pathIndex = 0;
                        this.pathGoal = null;
                        this.deliverResources();
                    }
                }
            }

            if (!reachedTarget && this.targetX !== null && this.targetY !== null) {
                if (dist > 3) {
                    const step = Math.min(dist, this.speed * CONFIG.UNIT_SPEED_SCALE);
                    const vx = (dx / dist) * step;
                    const vy = (dy / dist) * step;
                    const moved = moveUnitWithCollision(this, vx, vy);
                    if (!moved && !this.path) {
                        this.path = findPath(this.x, this.y, requestedTargetX, requestedTargetY, this.size || 8);
                        this.pathIndex = 0;
                    } else if (!moved && this.path && this.pathIndex < this.path.length) {
                        this.path = findPath(this.x, this.y, requestedTargetX, requestedTargetY, this.size || 8);
                        this.pathIndex = 0;
                    }
                    if (!moved) {
                        this.stuckFrames = (this.stuckFrames || 0) + 1;
                        if (this.stuckFrames > 25 && !this.gathering && !this.returning) {
                            this.targetX = null;
                            this.targetY = null;
                            this.stuckFrames = 0;
                        }
                    } else {
                        this.stuckFrames = 0;
                    }
                } else {
                    this.targetX = null;
                    this.targetY = null;
                    this.path = null;
                    this.pathIndex = 0;
                    this.pathGoal = null;
                    if (this.gathering && !this.returning && this.gatherTimer <= 0) {
                        this.gatherTimer = CONFIG.GATHER_TIME;
                    } else if (this.returning) {
                        this.deliverResources();
                    }
                }
            }
        }
    }
    
    getDistanceTo(other) {
        const position = getEntityPosition(other);
        const dx = position.x - this.x;
        const dy = position.y - this.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    findNearestEnemy() {
        let closest = null;
        let closestDist = Infinity;
        
        let enemies = [];
        if (this.isNeutral) {
            if (this.returningHome) return null;
            // Creeps entram em aggro apenas quando o inimigo se aproxima de home ou do creep
            const distFromHome = Math.hypot(this.x - this.homeX, this.y - this.homeY);
            if (distFromHome > 200) {
                return null;
            }
            enemies = gameState.units.filter(u => u.owner !== 'neutral' && u.health > 0);
            for (const enemy of enemies) {
                const distToMob = this.getDistanceTo(enemy);
                const enemyDistFromHome = Math.hypot(enemy.x - this.homeX, enemy.y - this.homeY);
                // Aggro dispara se inimigo estiver dentro do raio de aggro do mob ou do acampamento
                if ((distToMob <= this.aggroRange || enemyDistFromHome <= this.aggroRange) && distToMob < closestDist) {
                    closest = enemy;
                    closestDist = distToMob;
                }
            }
            return closest;
        }

        enemies = [
            ...gameState.units.filter(u => u.health > 0 && isEntityHostile(this, u)),
            ...gameState.buildings.filter(b => b.health > 0 && isEntityHostile(this, b))
        ];
        
        for (const enemy of enemies) {
            const dist = this.getDistanceTo(enemy);
            if (dist <= this.attackRange && dist < closestDist) {
                closest = enemy;
                closestDist = dist;
            }
        }
        
        return closest;
    }
    
    attackUnit(target) {
        this.cooldown = this.attackCooldown;
        
        let projColor = '#4488ff';
        if (this.isHero) projColor = '#fbbf24';
        else if (this.isNeutral) projColor = '#a855f7';
        else if (this.isEnemy) projColor = '#ff4444';

        gameState.projectiles.push({
            x: this.x,
            y: this.y,
            target: target,
            targetPosition: getEntityPosition(target),
            speed: 5,
            damage: this.attack,
            color: projColor,
            sourceUnit: this
        });
        
        // Efeito de impacto
        for (let i = 0; i < 3; i++) {
            gameState.particles.push({
                x: getEntityPosition(target).x,
                y: getEntityPosition(target).y,
                vx: (Math.random() - 0.5) * 3,
                vy: (Math.random() - 0.5) * 3,
                life: 14,
                maxLife: 14,
                color: this.isHero ? '#fef08a' : '#ffaa00',
                size: 3,
            });
        }
    }
    
    findResource(preferredType = null) {
        let closest = null;
        let closestDist = Infinity;
        
        const targetTypes = preferredType
            ? [preferredType === 'gold' ? TERRAIN.GOLD_MINE : TERRAIN.TREE]
            : [TERRAIN.GOLD_MINE, TERRAIN.TREE];
        
        for (const resType of targetTypes) {
            for (let y = 0; y < CONFIG.MAP_HEIGHT; y++) {
                for (let x = 0; x < CONFIG.MAP_WIDTH; x++) {
                    if (this.owner === 'player' && (!gameState.explored || !gameState.explored[y] || !gameState.explored[y][x])) {
                        continue;
                    }
                    if (gameState.map[y][x] === resType && (gameState.resourceAmounts[y]?.[x] || 0) > 0) {
                        const tileCenterX = x * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
                        const tileCenterY = y * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
                        const dist = Math.hypot(tileCenterX - this.x, tileCenterY - this.y);
                            
                        if (dist < closestDist) {
                            closest = {
                                x,
                                y,
                                type: resType === TERRAIN.GOLD_MINE ? 'gold' : 'wood'
                            };
                            closestDist = dist;
                        }
                    }
                }
            }
        }
        
        if (closest) {
            this.assignResourceHarvest(closest.x, closest.y);
        } else {
            this.autoGathering = false;
            this.gathering = false;
            this.gatherType = null;
            this.gatherTargetTile = null;
            this.clusterOrigin = null;
        }
    }

    findBase() {
        let closest = null;
        let closestDist = Infinity;
        for (const building of gameState.buildings) {
            if (building.owner === this.owner && (building.name === 'Town Hall' || building.type?.name === 'Town Hall') && building.health > 0) {
                const bPos = getEntityPosition(building);
                const dist = Math.hypot(bPos.x - this.x, bPos.y - this.y);
                if (dist < closestDist) {
                    closest = building;
                    closestDist = dist;
                }
            }
        }
        return closest;
    }

    deliverResources() {
        const amount = this.gatherAmount;
        if (!gameState.factionResources) gameState.factionResources = {};
        if (!gameState.factionResources[this.owner]) {
            gameState.factionResources[this.owner] = { gold: 200, wood: 150, foodUsed: 3, foodMax: 5 };
        }
        
        const facRes = gameState.factionResources[this.owner];
        if (this.gatherType === 'gold') facRes.gold += amount;
        if (this.gatherType === 'wood') facRes.wood += amount;

        // Manter sincronizado com gameState.resources e gameState.enemyResources para compatibilidade
        if (this.owner === 'player' || this.owner === 'p0') {
            if (this.gatherType === 'gold') gameState.resources.gold += amount;
            if (this.gatherType === 'wood') gameState.resources.wood += amount;
        } else if (this.owner === 'enemy' || this.owner === 'p1') {
            if (this.gatherType === 'gold') gameState.enemyResources.gold += amount;
            if (this.gatherType === 'wood') gameState.enemyResources.wood += amount;
        }

        
        const lastType = this.gatherType;
        const lastOrigin = this.clusterOrigin;
        
        this.gathering = false;
        this.returning = false;
        this.gatherAmount = 0;

        if (this.autoGathering) {
            if (lastOrigin) {
                const cluster = getResourceCluster(lastOrigin.x, lastOrigin.y);
                if (cluster && cluster.totalRemaining > 0) {
                    this.assignResourceHarvest(lastOrigin.x, lastOrigin.y);
                    return;
                }
            }
            this.findResource(lastType);
        } else {
            this.gatherType = null;
            this.gatherTargetTile = null;
            this.clusterOrigin = null;
        }
    }
    
    draw() {
        const tileX = Math.floor(this.x / CONFIG.TILE_SIZE);
        const tileY = Math.floor(this.y / CONFIG.TILE_SIZE);
        const myRole = gameState.myRole || 'player';
        const myTeam = (gameState.teams && gameState.teams[myRole]) || 1;
        const myUnitTeam = this.team || (gameState.teams && gameState.teams[this.owner]) || (this.owner === 'player' ? 1 : 2);
        const isAlly = this.owner === myRole || (!this.isNeutral && myUnitTeam === myTeam);
        if (!isAlly && (!gameState.visibility[tileY] || !gameState.visibility[tileY][tileX])) return;
        const screenX = (this.x - gameState.camera.x) * gameState.camera.zoom + canvas.width / 2;
        const screenY = (this.y - gameState.camera.y) * gameState.camera.zoom + canvas.height / 2;
        const screenSize = this.size * gameState.camera.zoom;
        
        if (screenX < -50 || screenX > canvas.width + 50 || screenY < -50 || screenY > canvas.height + 50) return;
        
        // Sombra
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.ellipse(screenX, screenY + screenSize, screenSize * 0.8, screenSize * 0.4, 0, 0, Math.PI * 2);
        // Anel de Facção/Equipe (cor selecionada no lobby)
        const factionColor = !this.isNeutral ? (CONFIG.FACTION_COLORS?.[this.owner] || this.color) : this.color;
        ctx.fillStyle = factionColor;
        ctx.beginPath();
        ctx.arc(screenX, screenY, screenSize + 1.5, 0, Math.PI * 2);
        ctx.fill();

        // Corpo interno
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(screenX, screenY, Math.max(2, screenSize - 1.5), 0, Math.PI * 2);
        ctx.fill();
        
        // Destaque se selecionado ou com hover no painel de seleção
        const isSelected = gameState.selectedUnits.includes(this);
        const isHovered = gameState.hoveredUnitId === this.id;
        
        if (isSelected || isHovered) {
            ctx.save();
            ctx.strokeStyle = isHovered ? '#ffd700' : '#2ecc71';
            ctx.lineWidth = isHovered ? 3 : 2;
            if (isHovered) {
                ctx.shadowColor = '#ffd700';
                ctx.shadowBlur = 8;
            }
            ctx.beginPath();
            ctx.arc(screenX, screenY, screenSize + 2, 0, Math.PI * 2);
            ctx.stroke();
            
            // Indicador de seta dourada se hovered na UI
            if (isHovered) {
                ctx.fillStyle = '#ffd700';
                ctx.beginPath();
                ctx.moveTo(screenX, screenY - screenSize - 6);
                ctx.lineTo(screenX - 5, screenY - screenSize - 14);
                ctx.lineTo(screenX + 5, screenY - screenSize - 14);
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();
        }

        // Aura sagrada do Herói
        if (this.isHero) {
            ctx.save();
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 1.8;
            ctx.shadowColor = '#fbbf24';
            ctx.shadowBlur = 10;
            ctx.beginPath();
            const pulse = Math.sin(Date.now() / 250) * 2;
            ctx.arc(screenX, screenY, screenSize + 5 + pulse, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
        
        // Ícone
        ctx.font = `${screenSize}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.icon, screenX, screenY);
        
        // Indicador de recurso carregado
        if (this.returning && this.gatherAmount > 0) {
        ctx.font = `${Math.max(10, screenSize * 0.9)}px Arial`;
        ctx.fillText(this.gatherType === 'gold' ? '🪙' : '🪵', screenX + screenSize * 0.8, screenY - screenSize * 0.6);
        }

        // Indicador de progresso de coleta / extração
        if (this.gathering && !this.returning && this.gatherTimer > 0) {
            const barW = screenSize * 2.2;
            const barH = 3;
            const barX = screenX - barW / 2;
            const barY = screenY - screenSize - 12;
            const progress = 1 - (this.gatherTimer / CONFIG.GATHER_TIME);

            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(barX, barY, barW, barH);
            ctx.fillStyle = this.gatherType === 'gold' ? '#f59e0b' : '#10b981';
            ctx.fillRect(barX, barY, barW * progress, barH);

            ctx.font = '10px Arial';
            ctx.fillText(this.gatherType === 'gold' ? '⛏️' : '🪓', screenX, barY - 6);
        }

        // Indicador de martelo trabalhando em construção
        if (this.isBuilding && this.buildingTarget) {
            const hammerY = screenY - screenSize - 12 + Math.sin(Date.now() / 110) * 3;
            ctx.font = '12px Arial';
            ctx.fillText('🔨', screenX, hammerY);
        }

        // Indicador de chave/reparo trabalhando em conserto de construção
        if (this.isRepairing && this.repairTarget) {
            const wrenchY = screenY - screenSize - 12 + Math.sin(Date.now() / 110) * 3;
            ctx.font = '12px Arial';
            ctx.fillText('🔧', screenX, wrenchY);
        }

        // Indicador de aldeão ocioso para facilitar a identificação no mapa
        if (this.canGather && !this.gathering && !this.returning && !this.buildingTarget && !this.repairTarget &&
            this.targetX === null && this.targetY === null) {
            ctx.font = '12px Arial';
            ctx.fillText('💤', screenX, screenY - screenSize - 12);
        }

        // Barra de vida
        if (this.health < this.maxHealth) {
            const barWidth = screenSize * 2;
            const barHeight = 4;
            const barX = screenX - barWidth / 2;
            const barY = screenY - screenSize - 6;
            
            ctx.fillStyle = '#333';
            ctx.fillRect(barX, barY, barWidth, barHeight);
            
            const healthPercent = this.health / this.maxHealth;
            ctx.fillStyle = healthPercent > 0.5 ? '#00ff00' : healthPercent > 0.25 ? '#ffff00' : '#ff0000';
            ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);
        }
    }
}

class Building {
    constructor(type, x, y, owner, isConstructed = true, customId = null) {
        this.type = type;
        this.isConstructed = isConstructed;
        this.buildTime = type.buildTime || 180;
        this.buildProgress = isConstructed ? this.buildTime : 0;
        this.maxHealth = type.health;
        this.health = isConstructed ? type.health : Math.max(15, Math.floor(type.health * 0.1));
        this.width = type.width;
        this.height = type.height;
        this.color = type.color;
        this.icon = type.icon;
        this.name = type.name;
        this.owner = owner;
        this.providesFood = type.providesFood || false;
        this.foodAmount = type.foodAmount || 0;
        this.trains = type.trains || [];
        this.trainQueue = []; // [{ unitType, duration, progress }]
        this.trainCooldown = 0;
        this.canAttack = type.canAttack || false;
        this.attack = type.attack || 0;
        this.attackRange = type.attackRange || 0;
        this.attackCooldown = type.attackCooldown || 60;
        this.cooldown = 0;
        
        this.x = x;
        this.y = y;
        this.id = customId || Math.random().toString(36).substr(2, 9);
    }

    queueUnit(unitType, unitId = null) {
        if (!this.isConstructed) return false;
        const def = (typeof UNIT_DEFS !== 'undefined' && UNIT_DEFS[unitType]) || (typeof window !== 'undefined' && window.UNIT_DEFS ? window.UNIT_DEFS[unitType] : null);
        const duration = def?.trainTime || 180;
        this.trainQueue.push({
            unitType,
            duration,
            progress: 0,
            unitId: unitId || Math.random().toString(36).substr(2, 9)
        });
        return true;
    }

    progressBuild(amount = 1) {
        if (this.isConstructed) return true;
        this.buildProgress = Math.min(this.buildTime, this.buildProgress + amount);
        const hpRatio = this.buildProgress / this.buildTime;
        const minHp = Math.max(15, Math.floor(this.type.health * 0.1));
        this.health = Math.min(this.maxHealth, Math.floor(minHp + (this.maxHealth - minHp) * hpRatio));
        if (this.buildProgress >= this.buildTime) {
            this.finishConstruction();
            return true;
        }
        return false;
    }

    finishConstruction() {
        if (this.isConstructed) return;
        this.isConstructed = true;
        this.health = this.maxHealth;
        this.buildProgress = this.buildTime;
        
        if (this.providesFood) {
            if (this.owner === 'player') {
                gameState.resources.foodMax += this.foodAmount;
            } else {
                gameState.enemyResources.foodMax += this.foodAmount;
            }
        }

        // Partículas de conclusão de obra
        const cx = (this.x + this.width / 2) * CONFIG.TILE_SIZE;
        const cy = (this.y + this.height / 2) * CONFIG.TILE_SIZE;
        for (let i = 0; i < 24; i++) {
            gameState.particles.push({
                x: cx + (Math.random() - 0.5) * this.width * CONFIG.TILE_SIZE,
                y: cy + (Math.random() - 0.5) * this.height * CONFIG.TILE_SIZE,
                vx: (Math.random() - 0.5) * 4,
                vy: (Math.random() - 0.5) * 4 - 1.2,
                life: 30,
                maxLife: 30,
                color: this.owner === 'player' ? '#ffd700' : '#e74c3c',
                size: 3.5,
            });
        }
    }

    update() {
        if (!this.isConstructed) return;
        if (this.cooldown > 0) this.cooldown--;
        
        // Produção de unidades com tempo e barra de progresso
        if (this.trainQueue && this.trainQueue.length > 0) {
            const currentOrder = this.trainQueue[0];
            currentOrder.progress++;
            if (currentOrder.progress >= currentOrder.duration) {
                // Concluir produção e invocar a unidade
                const def = (typeof UNIT_DEFS !== 'undefined' && UNIT_DEFS[currentOrder.unitType]) || (typeof window !== 'undefined' && window.UNIT_DEFS ? window.UNIT_DEFS[currentOrder.unitType] : null);
                if (def) {
                    const fromX = (this.x + this.width / 2) * CONFIG.TILE_SIZE + (Math.random() * 16 - 8);
                    const fromY = (this.y + this.height + 1) * CONFIG.TILE_SIZE;
                    const standPos = getStandPositionNearBuilding(this, fromX, fromY, def.size || 8);
                    const unit = new Unit(def, standPos.x, standPos.y, this.owner, currentOrder.unitId || null);
                    
                    const myRole = gameState.myRole || 'player';
                    if (def.isHero && this.owner === myRole) {
                        const lvl = gameState.heroLevel || 1;
                        unit.maxHealth = def.health + (lvl - 1) * CONFIG.HERO_LEVELUP_HP_BONUS;
                        unit.health = unit.maxHealth;
                        unit.attack = def.attack + (lvl - 1) * CONFIG.HERO_LEVELUP_ATK_BONUS;
                        unit.size = Math.min(CONFIG.HERO_MAX_SIZE, def.size + (lvl - 1) * CONFIG.HERO_LEVELUP_SIZE_BONUS);
                        gameState.hero = unit;
                        gameState.heroDead = false;
                    }

                    gameState.units.push(unit);
                    if (this.owner === myRole && gameState.rallyPoint) {
                        unit.targetX = gameState.rallyPoint.x;
                        unit.targetY = gameState.rallyPoint.y;
                    }

                    // Efeito de conclusão
                    for (let i = 0; i < 8; i++) {
                        gameState.particles.push({
                            x: standPos.x,
                            y: standPos.y,
                            vx: (Math.random() - 0.5) * 3,
                            vy: (Math.random() - 0.5) * 3,
                            life: 20,
                            maxLife: 20,
                            color: this.owner === 'player' ? '#ffd700' : '#ff4444',
                            size: 3,
                        });
                    }
                }
                this.trainQueue.shift();
            }
        }
        
        if (this.canAttack && this.cooldown <= 0) {
            const bPos = getEntityPosition(this);
            const targets = gameState.units.filter(u => u.health > 0 && isEntityHostile(this, u));


            let closest = null;
            let closestDist = Infinity;
            for (const target of targets) {
                const dist = Math.hypot(target.x - bPos.x, target.y - bPos.y);
                if (dist <= this.attackRange && dist < closestDist) {
                    closest = target;
                    closestDist = dist;
                }
            }

            if (closest) {
                this.cooldown = this.attackCooldown;
                gameState.projectiles.push({
                    x: bPos.x,
                    y: bPos.y,
                    target: closest,
                    targetPosition: getEntityPosition(closest),
                    speed: 7,
                    damage: this.attack,
                    color: this.owner === 'enemy' ? '#ff4444' : '#4488ff',
                });
            }
        }
    }

    updateVisuals() {
        if (this.trainQueue && this.trainQueue.length > 0) {
            const currentOrder = this.trainQueue[0];
            if (currentOrder.progress < currentOrder.duration) {
                currentOrder.progress++;
            }
        }
    }
    
    draw() {
        const myRole = gameState.myRole || 'player';
        const myTeam = (gameState.teams && gameState.teams[myRole]) || 1;
        const bTeam = (gameState.teams && gameState.teams[this.owner]) || (this.owner === 'player' ? 1 : 2);
        const isAlly = this.owner === myRole || bTeam === myTeam;
        if (!isAlly) {
            const centerX = Math.floor((this.x + this.width / 2));
            const centerY = Math.floor((this.y + this.height / 2));
            if (!gameState.visibility[centerY] || !gameState.visibility[centerY][centerX]) return;
        }
        const screenX = (this.x * CONFIG.TILE_SIZE - gameState.camera.x) * gameState.camera.zoom + canvas.width / 2;
        const screenY = (this.y * CONFIG.TILE_SIZE - gameState.camera.y) * gameState.camera.zoom + canvas.height / 2;
        const screenWidth = this.width * CONFIG.TILE_SIZE * gameState.camera.zoom;
        const screenHeight = this.height * CONFIG.TILE_SIZE * gameState.camera.zoom;
        
        if (screenX + screenWidth < 0 || screenX > canvas.width || screenY + screenHeight < 0 || screenY > canvas.height) return;
        
        // Sombra
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(screenX + 3, screenY + 3, screenWidth, screenHeight);
        
        if (!this.isConstructed) {
            // ESTRUTURA EM CONSTRUÇÃO (CANTEIRO DE OBRAS / SCAFFOLDING)
            const progressRatio = Math.max(0, Math.min(1, this.buildProgress / this.buildTime));
            
            // Fundação
            ctx.fillStyle = 'rgba(70, 50, 30, 0.75)';
            ctx.fillRect(screenX, screenY, screenWidth, screenHeight);

            // Vigas de madeira / Andaimes em padrão diagonal
            ctx.save();
            ctx.beginPath();
            ctx.rect(screenX, screenY, screenWidth, screenHeight);
            ctx.clip();

            ctx.strokeStyle = '#b8860b';
            ctx.lineWidth = 2;
            const step = 14 * gameState.camera.zoom;
            for (let ox = -screenHeight; ox < screenWidth; ox += step) {
                ctx.beginPath();
                ctx.moveTo(screenX + ox, screenY);
                ctx.lineTo(screenX + ox + screenHeight, screenY + screenHeight);
                ctx.stroke();
            }

            // Progresso de preenchimento de baixo para cima
            ctx.fillStyle = this.color;
            ctx.globalAlpha = 0.55;
            const filledH = screenHeight * progressRatio;
            ctx.fillRect(screenX, screenY + screenHeight - filledH, screenWidth, filledH);
            ctx.globalAlpha = 1.0;
            ctx.restore();

            // Borda do andaime
            ctx.strokeStyle = '#d4a373';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 3]);
            ctx.strokeRect(screenX, screenY, screenWidth, screenHeight);
            ctx.setLineDash([]);

            // Ícone do martelo no centro
            const iconSize = Math.min(screenWidth, screenHeight) * 0.4;
            ctx.font = `${iconSize}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🔨', screenX + screenWidth / 2, screenY + screenHeight / 2);

            // Barra de progresso da obra acima
            const barW = Math.max(screenWidth, 36 * gameState.camera.zoom);
            const barH = 5 * gameState.camera.zoom;
            const barX = screenX + (screenWidth - barW) / 2;
            const barY = screenY - 12 * gameState.camera.zoom;

            ctx.fillStyle = 'rgba(10, 10, 10, 0.85)';
            ctx.fillRect(barX, barY, barW, barH);
            ctx.strokeStyle = '#8b7355';
            ctx.lineWidth = 1;
            ctx.strokeRect(barX, barY, barW, barH);

            ctx.fillStyle = '#f59e0b';
            ctx.fillRect(barX + 0.5, barY + 0.5, (barW - 1) * progressRatio, barH - 1);

            // Texto percentual de construção
            ctx.font = `bold ${Math.max(9, 10 * gameState.camera.zoom)}px Segoe UI, sans-serif`;
            ctx.fillStyle = '#ffd700';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2.5;
            const pctText = `${Math.round(progressRatio * 100)}%`;
            ctx.strokeText(pctText, screenX + screenWidth / 2, barY - 4);
            ctx.fillText(pctText, screenX + screenWidth / 2, barY - 4);

        } else {
            // EDIFÍCIO CONCLUÍDO
            ctx.fillStyle = this.color;
            ctx.fillRect(screenX, screenY, screenWidth, screenHeight);
            
            // Borda com a cor selecionada da Facção/Jogador
            const factionBorderColor = CONFIG.FACTION_COLORS?.[this.owner] || (this.owner === 'player' ? '#ffd700' : '#ff4444');
            ctx.strokeStyle = factionBorderColor;
            ctx.lineWidth = 2.5;
            ctx.strokeRect(screenX, screenY, screenWidth, screenHeight);

            // Faixa/Estandarte superior com a cor da Facção
            ctx.fillStyle = factionBorderColor;
            ctx.fillRect(screenX, screenY, screenWidth, Math.max(3, 4 * gameState.camera.zoom));

            // Ícone
            ctx.font = `${Math.min(screenWidth, screenHeight) * 0.5}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(this.icon, screenX + screenWidth / 2, screenY + screenHeight / 2);
            
            // Barra de vida (quando danificado)
            if (this.health < this.maxHealth) {
                const barWidth = screenWidth;
                const barHeight = 5;
                const barX = screenX;
                const barY = screenY - 8;
                
                ctx.fillStyle = '#333';
                ctx.fillRect(barX, barY, barWidth, barHeight);
                
                const healthPercent = this.health / this.maxHealth;
                ctx.fillStyle = healthPercent > 0.5 ? '#00ff00' : healthPercent > 0.25 ? '#ffff00' : '#ff0000';
                ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);
            }

            // Barra de progresso de produção de unidades
            if (this.trainQueue && this.trainQueue.length > 0) {
                const currentOrder = this.trainQueue[0];
                const trainRatio = Math.max(0, Math.min(1, currentOrder.progress / currentOrder.duration));
                const barWidth = screenWidth;
                const barHeight = 4;
                const barX = screenX;
                const barY = screenY + screenHeight + 3;

                ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                ctx.fillRect(barX, barY, barWidth, barHeight);
                ctx.fillStyle = '#38bdf8';
                ctx.fillRect(barX, barY, barWidth * trainRatio, barHeight);

                // Ícone ou indicador de quantidade na fila
                if (this.trainQueue.length > 1) {
                    ctx.font = 'bold 9px Segoe UI, sans-serif';
                    ctx.fillStyle = '#38bdf8';
                    ctx.fillText(`+${this.trainQueue.length - 1}`, screenX + screenWidth + 8, barY + 3);
                }
            }
        }

        if (gameState.selectedBuilding === this) {
            ctx.strokeStyle = '#f2d18a';
            ctx.lineWidth = 3;
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(screenX - 3, screenY - 3, screenWidth + 6, screenHeight + 6);
            ctx.setLineDash([]);
        }
    }
}

window.Unit = Unit;
window.Building = Building;
window.getEntityPosition = getEntityPosition;
window.getEntityTeam = getEntityTeam;
window.isEntityHostile = isEntityHostile;
window.isCollidingWithObstacle = isCollidingWithObstacle;
window.moveUnitWithCollision = moveUnitWithCollision;
window.findPath = findPath;
window.resolveUnitCollisions = resolveUnitCollisions;
window.getStandPositionNearTile = getStandPositionNearTile;
window.getStandPositionNearBuilding = getStandPositionNearBuilding;
window.assignFormationPositions = assignFormationPositions;
window.getResourceCluster = getResourceCluster;
window.getStandPositionNearCluster = getStandPositionNearCluster;

export {
    Unit,
    Building,
    getEntityPosition,
    getEntityTeam,
    isEntityHostile,
    isCollidingWithObstacle,
    moveUnitWithCollision,
    findPath,
    resolveUnitCollisions,
    getStandPositionNearTile,
    getStandPositionNearBuilding,
    assignFormationPositions,
    getResourceCluster,
    getStandPositionNearCluster
};

