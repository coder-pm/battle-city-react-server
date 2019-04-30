/**
 * Enum NetworkPacket - network packet.
 */
export enum NetworkPacket {
    CONNECTED = 'connect',
    HANDSHAKING = 'handshaking',
    BOARD_STATE_OBSTACLES = 'board.state.obstacles',
    BOARD_STATE_TANKS = 'board.state.tanks',
    BOARD_STATE_MISSILES = 'board.state.missiles',
    TANK_EVENT_KEYBOARD = 'tank.event.keyboard'
}