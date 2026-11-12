// Keyboard and Gamepad API input manager for AI-Bomberman

export interface PlayerInput {
  dx: number;       // -1, 0, 1
  dy: number;       // -1, 0, 1
  bomb: boolean;    // Pressed this frame
  bombDown: boolean;// Held down
  skill: boolean;   // Skill button pressed this frame
  pause: boolean;   // Pause/Resume pressed
  restart: boolean; // Restart pressed
}

export interface GamepadInfo {
  index: number;
  id: string;
  connected: boolean;
  hasVibration: boolean;
}

export class InputManager {
  private keysDown: Set<string> = new Set();
  private keysPressed: Set<string> = new Set();
  private prevPadButtons: Map<number, boolean[]> = new Map();
  private connectedGamepads: Map<number, GamepadInfo> = new Map();
  public onGamepadChange?: (pads: GamepadInfo[]) => void;

  constructor() {
    this.initKeyboard();
    this.initGamepad();
  }

  private initKeyboard() {
    window.addEventListener('keydown', (e) => {
      // Prevent scrolling on arrow keys and space
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Spacebar'].includes(e.key)) {
        e.preventDefault();
      }
      if (!this.keysDown.has(e.code)) {
        this.keysPressed.add(e.code);
      }
      this.keysDown.add(e.code);
    });

    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code);
    });

    // Window blur safety
    window.addEventListener('blur', () => {
      this.keysDown.clear();
      this.keysPressed.clear();
    });
  }

  private initGamepad() {
    window.addEventListener('gamepadconnected', (e: GamepadEvent) => {
      const pad = e.gamepad;
      this.connectedGamepads.set(pad.index, {
        index: pad.index,
        id: pad.id,
        connected: true,
        hasVibration: !!(pad.vibrationActuator || (pad as unknown as { hapticActuators?: unknown[] }).hapticActuators?.length),
      });
      if (this.onGamepadChange) {
        this.onGamepadChange(Array.from(this.connectedGamepads.values()));
      }
    });

    window.addEventListener('gamepaddisconnected', (e: GamepadEvent) => {
      this.connectedGamepads.delete(e.gamepad.index);
      this.prevPadButtons.delete(e.gamepad.index);
      if (this.onGamepadChange) {
        this.onGamepadChange(Array.from(this.connectedGamepads.values()));
      }
    });
  }

  public getConnectedGamepads(): GamepadInfo[] {
    return Array.from(this.connectedGamepads.values());
  }

  /**
   * Triggers haptic vibration rumble on a gamepad (if supported)
   */
  public vibrate(gamepadIndex: number, durationMs: number = 200, strong: number = 0.6, weak: number = 0.4) {
    try {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = gamepads[gamepadIndex];
      if (!pad) return;

      if (pad.vibrationActuator && typeof pad.vibrationActuator.playEffect === 'function') {
        pad.vibrationActuator.playEffect('dual-rumble', {
          startDelay: 0,
          duration: durationMs,
          weakMagnitude: weak,
          strongMagnitude: strong,
        }).catch(() => {
          // Ignore vibration rejection
        });
      }
    } catch {
      // Ignore vibration errors on unsupporting browsers
    }
  }

  /**
   * Polls input state for a specific player (Player 1 by default connects to Keyboard + Gamepad 0)
   */
  public getPlayerInput(playerId: number): PlayerInput {
    let dx = 0;
    let dy = 0;
    let bomb = false;
    let bombDown = false;
    let pause = false;
    let restart = false;

    // 1. Keyboard Controls (Player 1 only or shared)
    if (playerId === 0) {
      // Movement: WASD or Arrow Keys
      const isUp = this.keysDown.has('ArrowUp') || this.keysDown.has('KeyW');
      const isDown = this.keysDown.has('ArrowDown') || this.keysDown.has('KeyS');
      const isLeft = this.keysDown.has('ArrowLeft') || this.keysDown.has('KeyA');
      const isRight = this.keysDown.has('ArrowRight') || this.keysDown.has('KeyD');

      if (isLeft && !isRight) dx = -1;
      else if (isRight && !isLeft) dx = 1;

      if (isUp && !isDown) dy = -1;
      else if (isDown && !isUp) dy = 1;

      // Bomb: Space, Enter, KeyJ, KeyZ
      bomb = this.keysPressed.has('Space') || this.keysPressed.has('Enter') || this.keysPressed.has('KeyZ') || this.keysPressed.has('KeyJ');
      bombDown = this.keysDown.has('Space') || this.keysDown.has('Enter') || this.keysDown.has('KeyZ') || this.keysDown.has('KeyJ');

      // Skill: KeyE, KeyK, ShiftLeft, ShiftRight, KeyX
      const skill = this.keysPressed.has('KeyE') || this.keysPressed.has('KeyK') || this.keysPressed.has('ShiftLeft') || this.keysPressed.has('ShiftRight') || this.keysPressed.has('KeyX');

      // Pause & Restart
      pause = this.keysPressed.has('KeyP') || this.keysPressed.has('Escape');
      restart = this.keysPressed.has('KeyR');

      if (skill) {
        // will be returned below
      }
    }

    let skill = false;
    if (playerId === 0) {
      skill = this.keysPressed.has('KeyE') || this.keysPressed.has('KeyK') || this.keysPressed.has('ShiftLeft') || this.keysPressed.has('ShiftRight') || this.keysPressed.has('KeyX');
    }

    // 2. Gamepad Controls (Gamepad Index corresponds to Player ID)
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = gamepads[playerId];

    if (pad && pad.connected) {
      // Keep track of connected pad
      if (!this.connectedGamepads.has(pad.index)) {
        this.connectedGamepads.set(pad.index, {
          index: pad.index,
          id: pad.id,
          connected: true,
          hasVibration: !!pad.vibrationActuator,
        });
      }

      const prevButtons = this.prevPadButtons.get(pad.index) || [];
      const currentButtons: boolean[] = [];

      // D-Pad buttons (Standard Gamepad Mapping)
      // 12: Up, 13: Down, 14: Left, 15: Right
      const dpadUp = pad.buttons[12]?.pressed;
      const dpadDown = pad.buttons[13]?.pressed;
      const dpadLeft = pad.buttons[14]?.pressed;
      const dpadRight = pad.buttons[15]?.pressed;

      // Left Analog Stick (Axes 0: X, Axes 1: Y)
      const stickX = pad.axes[0] || 0;
      const stickY = pad.axes[1] || 0;
      const DEADZONE = 0.25;

      let padDx = 0;
      let padDy = 0;

      if (dpadLeft || stickX < -DEADZONE) padDx = -1;
      else if (dpadRight || stickX > DEADZONE) padDx = 1;

      if (dpadUp || stickY < -DEADZONE) padDy = -1;
      else if (dpadDown || stickY > DEADZONE) padDy = 1;

      if (padDx !== 0) dx = padDx;
      if (padDy !== 0) dy = padDy;

      // Action Buttons for Bomb:
      // Button 0: A (Xbox) / Cross (PS)
      // Button 1: B (Xbox) / Circle (PS)
      // Button 5: RB / R1
      // Button 7: RT / R2
      const bombButtons = [0, 1, 5, 7];
      let padBombDown = false;
      let padBombJustPressed = false;

      for (const btnIndex of bombButtons) {
        const btn = pad.buttons[btnIndex];
        const isPressed = btn ? btn.pressed : false;
        currentButtons[btnIndex] = isPressed;

        if (isPressed) {
          padBombDown = true;
          if (!prevButtons[btnIndex]) {
            padBombJustPressed = true;
          }
        }
      }

      if (padBombJustPressed) bomb = true;
      if (padBombDown) bombDown = true;

      // Action Buttons for Skill:
      // Button 2: X (Xbox) / Square (PS)
      // Button 3: Y (Xbox) / Triangle (PS)
      // Button 4: LB / L1
      // Button 6: LT / L2
      const skillButtons = [2, 3, 4, 6];
      for (const btnIndex of skillButtons) {
        const btn = pad.buttons[btnIndex];
        const isPressed = btn ? btn.pressed : false;
        currentButtons[btnIndex] = isPressed;

        if (isPressed && !prevButtons[btnIndex]) {
          skill = true;
        }
      }

      // Start / Pause: Button 9 (Start / Options)
      const startBtn = pad.buttons[9]?.pressed || false;
      currentButtons[9] = startBtn;
      if (startBtn && !prevButtons[9]) {
        pause = true;
      }

      // Select / Back / Retry: Button 8 (Select / Share)
      const selectBtn = pad.buttons[8]?.pressed || false;
      currentButtons[8] = selectBtn;
      if (selectBtn && !prevButtons[8]) {
        restart = true;
      }

      this.prevPadButtons.set(pad.index, currentButtons);
    }

    return { dx, dy, bomb, bombDown, skill, pause, restart };
  }

  /**
   * Resets single-frame press states at the end of every update tick
   */
  public endFrame() {
    this.keysPressed.clear();
  }
}
