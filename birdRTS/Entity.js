class Entity {
    constructor(data) {
        this.id = data.id;
        this.ownerId = data.ownerId ?? null;

        this.x = data.x ?? 0;
        this.y = data.y ?? 0;
        this.serverX = data.x ?? 0;
        this.serverY = data.y ?? 0;

        this.dimx = data.dimx ?? 32;
        this.dimy = data.dimy ?? 32;

        this.rot = data.rot ?? 0;
        this.type = data.type ?? "unit";
        this.name = data.name ?? "";
        this.hp = data.hp ?? 0;
        this.maxHp = data.maxHp ?? 0;

        this.canMove = !!data.canMove;
        this.selectable = data.selectable !== false;
        this.iscontrollable = !!data.iscontrollable;

        this.selected = false;

        this.targetX = null;
        this.targetY = null;
    }

    applyServerState(data) {
        this.ownerId = data.ownerId ?? this.ownerId;

        this.serverX = data.x ?? this.serverX;
        this.serverY = data.y ?? this.serverY;

        this.dimx = data.dimx ?? this.dimx;
        this.dimy = data.dimy ?? this.dimy;
        this.rot = data.rot ?? this.rot;
        this.type = data.type ?? this.type;
        this.name = data.name ?? this.name;
        this.hp = data.hp ?? this.hp;
        this.maxHp = data.maxHp ?? this.maxHp;
        this.canMove = data.canMove ?? this.canMove;
        this.selectable = data.selectable ?? this.selectable;
        this.iscontrollable = data.iscontrollable ?? this.iscontrollable;
    }

    update(dt) {
        const lerp = Math.min(1, dt * 12);

        this.x += (this.serverX - this.x) * lerp;
        this.y += (this.serverY - this.y) * lerp;
    }

    containsPoint(px, py) {
        return (
            px >= this.x &&
            px <= this.x + this.dimx &&
            py >= this.y &&
            py <= this.y + this.dimy
        );
    }
}