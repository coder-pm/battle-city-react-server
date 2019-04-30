import {GAME_FRAMERATE, GAME_SERVER_ADDRESS, GAME_SERVER_PORT, TANK_HEIGHT, TANK_WIDTH} from "../../../constants";
import World from "../../../game/classes/World";
import uuidv4 from 'uuid/v4';
import SocketIO from 'socket.io';
import http, {Server} from "http";
import {NetworkPacket} from "../../../game/enums/NetworkPacket";
import TankModel from "../../../game/models/components/TankModel";
import {TankActor} from "../../../game/enums/TankActor";
import ObstacleModel from "../../../game/models/components/ObstacleModel";
import {Collision} from "../../../game/enums/Collision";
import {ObstacleType} from "../../../game/enums/ObstacleType";
import {TANK_MOVE_HANDLER} from "../../../game/handlers/TankMoveHandler";
import MissileModel from "../../../game/models/components/MissileModel";
import {MISSILE_MOVE_HANDLER} from "../../../game/handlers/MissileMoveHandler";
import Structure from "../../../game/models/Structure";
import {MAP_1} from "../../../game/maps/Map1";
import Point from "../../../game/models/Point";

/**
 * Class Game - class representing game.
 */
export default class Game {
    /**
     * Server properties.
     */
    protected server: Server;
    protected io: SocketIO.Server;
    protected clients: { [index: string]: { activeKey: string, spawnId: string } } = {};
    protected tanks: { [index: string]: TankModel } = {};
    protected obstacles: { [index: string]: ObstacleModel } = {};
    protected missiles: { [index: string]: MissileModel } = {};

    /**
     * Game properties.
     */
    protected world: World;
    protected spawnPoints: { [index: string]: Point } = {
        [uuidv4()]: {x: 25, y: 25},
        [uuidv4()]: {x: 363, y: 651},
        [uuidv4()]: {x: 771, y: 123},
        [uuidv4()]: {x: 843, y: 483}
    };

    /**
     * Game constructor.
     */
    public constructor() {
        this.server = http.createServer();
        this.io = SocketIO(this.server);
        this.world = new World();

        this.loop = this.loop.bind(this);
    }

    /**
     * Start game server.
     */
    public start(): void {
        // start game loop
        setInterval(this.loop, GAME_FRAMERATE);

        // register obstacles
        for (const obstacle of MAP_1) {
            let collision: Collision;
            switch (obstacle.type) {
                case ObstacleType.WATER:
                    collision = Collision.BLOCK_MOVE;
                    break;
                case ObstacleType.FOREST:
                    collision = Collision.BLOCK_NONE;
                    break;
                default:
                    collision = Collision.BLOCK_ALL
            }
            this.obstacles[obstacle.id] = obstacle;
            this.world.registerObject(obstacle, collision);
        }

        // bind socket.io
        this.io.on('connection', socket => {
            console.debug(`User connected: ${socket.id}`);

            if (Object.values(this.clients).length < Object.values(this.spawnPoints).length) {
                // create new tank (client) and register disconnect handler
                const clientId = uuidv4();
                socket.on('disconnect', () => {
                    delete this.clients[clientId];
                    delete this.tanks[clientId];
                    this.world.removeObject(clientId);
                    console.debug(`User disconnected: ${socket.id}`);
                });
                const spawnId = this.selectSpawnPoint();
                this.clients[clientId] = {activeKey: '', spawnId: spawnId};
                this.tanks[clientId] = {
                    id: clientId,
                    location: this.spawnPoints[spawnId],
                    dimension: {width: TANK_WIDTH, height: TANK_HEIGHT},
                    rotation: 90,
                    actor: TankActor.PLAYER
                };
                this.world.registerObject(this.tanks[clientId], Collision.BLOCK_ALL);

                // add keyboard listener
                socket.on(NetworkPacket.TANK_EVENT_KEYBOARD, (key: string) => {
                    this.clients[clientId].activeKey = key;
                    this.io.emit(NetworkPacket.TANK_EVENT_KEYBOARD, {
                        tankId: clientId,
                        key: key,
                        location: this.tanks[clientId].location,
                        rotation: this.tanks[clientId].rotation
                    })
                });

                // add fire listener
                socket.on(NetworkPacket.TANK_EVENT_FIRE, (missile: MissileModel) => {
                    if (Object.values(this.missiles).filter((m) => m.tankId === missile.tankId).length === 0) {
                        this.missiles[missile.id] = missile;
                        this.world.registerObject(missile, Collision.BLOCK_ALL);
                        this.io.emit(NetworkPacket.TANK_EVENT_FIRE, missile)
                    }
                });

                // sent client id and obstacles to new client
                socket.emit(NetworkPacket.HANDSHAKING, {clientId: clientId, full: false});
                socket.emit(NetworkPacket.BOARD_STATE_OBSTACLES, Object.values(this.obstacles));

                // send tank list to all players
                this.io.emit(NetworkPacket.BOARD_STATE_TANKS, Object.values(this.tanks));
            } else {
                socket.emit(NetworkPacket.HANDSHAKING, {clientId: null, full: true});
            }
        });

        // listen for new connections
        this.server.listen(GAME_SERVER_PORT, GAME_SERVER_ADDRESS, () => {
            console.log(`Listening on ${GAME_SERVER_ADDRESS}:${GAME_SERVER_PORT}`);
        });
    }

    /**
     * Select free spawn point.
     */
    protected selectSpawnPoint(): string {
        for (const spawnId in this.spawnPoints) {
            let free = true;
            for (const client of Object.values(this.clients)) {
                if (spawnId === client.spawnId) {
                    free = false;
                    break;
                }
            }
            if (free) {
                return spawnId;
            }
        }
        return '';
    }

    /**
     * Missile fell handler.
     *
     * @param missileId - missile id
     * @param tankId - id of tank that fired a missile
     * @param hitObjects - objects that were hit by missile
     */
    protected fellMissile(missileId: string, tankId: string, hitObjects: Array<Structure>): void {
        for (const hit of hitObjects) {
            // remove our missile because it hit something
            this.world.removeObject(missileId);
            delete this.missiles[missileId];

            // remove hit other missile that we hit
            if (typeof this.missiles[hit.id] === 'object' && this.missiles[hit.id].tankId !== tankId) {
                this.world.removeObject(hit.id);
                delete this.missiles[hit.id];
            }
            this.io.emit(NetworkPacket.BOARD_STATE_MISSILES, Object.values(this.missiles));

            // remove hit destructible obstacles
            if (
                typeof this.obstacles[hit.id] === 'object' &&
                [ObstacleType.METAL, ObstacleType.TRANSPARENT].indexOf(this.obstacles[hit.id].type) === -1
            ) {
                this.world.removeObject(hit.id);
                delete this.obstacles[hit.id];
                this.io.emit(NetworkPacket.BOARD_STATE_OBSTACLES, Object.values(this.obstacles));
            }

            // remove hit tanks
            if (typeof this.tanks[hit.id] === 'object' && hit.id !== tankId) {
                const tank = this.tanks[hit.id];
                this.world.removeObject(hit.id);
                delete this.tanks[hit.id];
                this.io.emit(NetworkPacket.BOARD_STATE_TANKS, Object.values(this.tanks));

                setTimeout(() => this.spawnTank(tank), 2500)
            }
        }
    }

    /**
     * Spawn tank.
     *
     * @param tank - tank definition
     */
    protected spawnTank(tank: TankModel): void {
        // check if its possible to spawn tank here
        if (this.world.isIntersecting(tank, Collision.BLOCK_MOVE).length === 0) {
            const client = this.clients[tank.id];
            tank.location = this.spawnPoints[client.spawnId];
            this.tanks[tank.id] = tank;
            this.world.registerObject(tank, Collision.BLOCK_ALL);
            this.io.emit(NetworkPacket.BOARD_STATE_TANKS, Object.values(this.tanks));
        } else {
            // defer spawning
            setTimeout(() => this.spawnTank(tank), 1000);
        }
    }

    /**
     * Game loop.
     */
    protected loop() {
        // perform tank moves
        for (const tank of Object.values(this.tanks)) {
            const client = this.clients[tank.id];
            const move = TANK_MOVE_HANDLER(tank, this.world, false, client.activeKey);
            tank.location = move.location;
            tank.rotation = move.rotation;
        }

        // perform missile moves
        for (const missile of Object.values(this.missiles)) {
            const move = MISSILE_MOVE_HANDLER(missile, this.world, missile.direction, missile.axis);
            // post move related actions
            if (move.hitObjects.length > 0) {
                this.fellMissile(missile.id, missile.tankId, move.hitObjects);
            } else {
                this.missiles[missile.id].location = move.location;
            }
        }
    }
}