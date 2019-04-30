import {GAME_FRAMERATE, GAME_SERVER_ADDRESS, GAME_SERVER_PORT, TANK_HEIGHT, TANK_WIDTH} from "../../../constants";
import World from "../../../game/classes/World";
import uuidv4 from 'uuid/v4';
import SocketIO from 'socket.io';
import http, {Server} from "http";
import {NetworkPacket} from "../../../game/enums/NetworkPacket";
import TankModel from "../../../game/models/components/TankModel";
import {TankActor} from "../../../game/enums/TankActor";
import ObstacleModel from "../../../game/models/components/ObstacleModel";
import {MAP_1} from "../../../game/maps/Map1";
import {Collision} from "../../../game/enums/Collision";
import {ObstacleType} from "../../../game/enums/ObstacleType";
import {TANK_MOVE_HANDLER} from "../../../game/handlers/TankMoveHandler";

/**
 * Class Game - class representing game.
 */
export default class Game {
    /**
     * Server properties.
     */
    protected server: Server;
    protected io: SocketIO.Server;
    protected clients: {
        [index: string]: {
            tank: TankModel,
            activeKey: string
        }
    } = {};
    protected obstacles: Array<ObstacleModel> = MAP_1;

    /**
     * Game properties.
     */
    protected world: World;

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
        for (const obstacle of this.obstacles) {
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
            this.world.registerObject(obstacle, collision);
        }

        // bind socket.io
        this.io.on('connection', socket => {
            console.debug(`User connected: ${socket.id}`);

            // create new tank (client) and register disconnect handler
            const clientId = uuidv4();
            socket.on('disconnect', () => {
                delete this.clients[clientId];
                this.world.removeObject(clientId);
                console.debug(`User disconnected: ${socket.id}`);
            });
            this.clients[clientId] = {
                tank: {
                    id: clientId,
                    location: {x: 25, y: 25},
                    dimension: {width: TANK_WIDTH, height: TANK_HEIGHT},
                    rotation: 90,
                    actor: TankActor.PLAYER
                },
                activeKey: ''
            };
            this.world.registerObject(this.clients[clientId].tank, Collision.BLOCK_ALL);

            // add keyboard listener
            socket.on(NetworkPacket.TANK_EVENT_KEYBOARD, (key) => {
                this.clients[clientId].activeKey = key;
                console.log('keyboard event', clientId, key);
                this.io.emit(NetworkPacket.TANK_EVENT_KEYBOARD, {
                    tankId: clientId,
                    key: key,
                    location: this.clients[clientId].tank.location,
                    rotation: this.clients[clientId].tank.rotation
                })
            });

            // sent client id and obstacles to new client
            socket.emit(NetworkPacket.HANDSHAKING, clientId);
            socket.emit(NetworkPacket.BOARD_STATE_OBSTACLES, this.obstacles);

            // send tank list to all players
            this.io.emit(NetworkPacket.BOARD_STATE_TANKS, Object.values(this.clients).map((client) => client.tank));
        });

        // listen for new connections
        this.server.listen(GAME_SERVER_PORT, GAME_SERVER_ADDRESS, () => {
            console.log(`Listening on ${GAME_SERVER_ADDRESS}:${GAME_SERVER_PORT}`);
        });
    }

    /**
     * Game loop.
     */
    protected loop() {
        // perform moves
        for (const client of Object.values(this.clients)) {
            const tank = client.tank;
            const move = TANK_MOVE_HANDLER(tank, this.world, false, client.activeKey);
            tank.location = move.location;
            tank.rotation = move.rotation;
        }
    }
}