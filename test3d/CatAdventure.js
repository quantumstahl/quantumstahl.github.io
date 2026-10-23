// NextWorld's gameplay home. Keep game rules here so PlayerController remains
// reusable for other controllable characters.
export class CatAdventure {
  constructor({ playerController, input }) {
    this.playerController = playerController;
    this.input = input;
    this.verticalVelocity = 0;
    this.onGround = true;
    this.gravity = -30;
    this.jumpVelocity = 12.5;
    this.airborneWorldHeight = null;
    this.jumpButton = this.createJumpButton();
  }

  createJumpButton() {
    const button = document.createElement("button");
    button.className = "mobile-paw-button";
    button.type = "button";
    button.setAttribute("aria-label", "Jump");
    button.title = "Jump";
    button.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><ellipse class="paw-pad" cx="50" cy="62" rx="27" ry="22"/><ellipse class="paw-toe" cx="24" cy="38" rx="10" ry="14" transform="rotate(-25 24 38)"/><ellipse class="paw-toe" cx="42" cy="25" rx="10" ry="14" transform="rotate(-8 42 25)"/><ellipse class="paw-toe" cx="61" cy="25" rx="10" ry="14" transform="rotate(8 61 25)"/><ellipse class="paw-toe" cx="78" cy="38" rx="10" ry="14" transform="rotate(25 78 38)"/></svg>`;
    button.addEventListener("pointerdown", event => {
      event.preventDefault();
      this.jump();
    });
    document.body.append(button);
    return button;
  }

  update(delta) {
    const controller = this.playerController;
    if (!controller.player) return;
    if (this.input.pressed(" ") || this.input.pressed("space")) this.jump();
    if (this.onGround) return;

    this.verticalVelocity += this.gravity * delta;
    const nextHeight = this.airborneWorldHeight + this.verticalVelocity * delta;
    const footHeight = this.airborneWorldHeight - controller.groundOffset;
    const groundHeight = controller.mapLoader.terrain.getSurfaceHeightAt?.(
      controller.player.position,
      footHeight + .02
    ) ?? controller.mapLoader.terrain.getHeightAt(controller.player.position);

    // Land on any Rockify deck below the cat. Surfaces above its feet are
    // ignored, so an underpass remains open while falling beneath a bridge.
    if (this.verticalVelocity <= 0 && nextHeight - controller.groundOffset <= groundHeight) {
      this.airborneWorldHeight = groundHeight + controller.groundOffset;
      controller.airborneWorldHeight = this.airborneWorldHeight;
      controller.player.position.y = this.airborneWorldHeight;
      controller.airborne = false;
      controller.jumpStartGroundHeight = null;
      this.verticalVelocity = 0;
      this.onGround = true;
      return;
    }

    this.airborneWorldHeight = nextHeight;
    controller.airborneWorldHeight = nextHeight;


    if(song!=='sounds/TheGoldenYarn.mp3'){
        song= 'sounds/TheGoldenYarn.mp3';
        audio.src = song;
        audio.play();
    }




  }

  jump() {
    const controller = this.playerController;
    if (!controller.player || !this.onGround) return false;
    this.verticalVelocity = this.jumpVelocity;
    controller.jumpStartGroundHeight = controller.getGroundHeight(controller.player.position);
    this.airborneWorldHeight = controller.player.position.y;
    controller.airborneWorldHeight = this.airborneWorldHeight;
    controller.airborne = true;
    this.onGround = false;
    return true;
  }
}
