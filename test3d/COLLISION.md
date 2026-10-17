# Compound GLB collision

CatAdventure now treats a GLB as a compound collider: every mesh has its own
local bounding box and its transform makes that box an oriented box in the
world. A building can therefore be one GLB while its separate wall, roof, and
floor meshes leave its doorways and rooms open.

For precise and cheap building collision, put simple box meshes in the GLB and
name them `COLLIDER_*`, `COLLISION_*`, or `COL_*` (for example,
`COLLIDER_left_wall`). If a GLB contains one or more of these named meshes,
only they collide; normal visible meshes are ignored for collision. Give those
proxy meshes an invisible material or turn off their visibility in the source
asset.

Use several thin boxes for walls, a separate slab for each floor, and leave the
door/window openings empty. All boxes can be rotated with the part they belong
to. Existing GLBs with no proxy meshes continue to collide from their visible
mesh bounds.
