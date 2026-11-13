// Entry point and UI coordinator for AI-Bomberman

import './style.css';
import { GameManager, GameStats } from './game';
import { sounds } from './audio';
import { GamepadInfo, MenuInput } from './input';
import { assets } from './assets';
import { CHARACTERS, loadCharacters } from './constants';

document.addEventListener('DOMContentLoaded', async () => {
  const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
  if (!canvas) return;

  // Preload character JSON definitions from characters/*/character.json, then load assets
  await loadCharacters();
  assets.registerCharacters(Object.values(CHARACTERS));
  await assets.loadAll();

  const game = new GameManager(canvas);

  // UI Elements
  const timerBadge = document.getElementById('timerBadge') as HTMLElement;
  const btnTitle = document.getElementById('btnTitle') as HTMLButtonElement;
  const btnSetup = document.getElementById('btnSetup') as HTMLButtonElement;
  const btnBgm = document.getElementById('btnBgm') as HTMLButtonElement;
  const btnSfx = document.getElementById('btnSfx') as HTMLButtonElement;
  const btnVibration = document.getElementById('btnVibration') as HTMLButtonElement;
  const btnReset = document.getElementById('btnReset') as HTMLButtonElement;
  const btnFullscreen = document.getElementById('btnFullscreen') as HTMLButtonElement;
  const btnPopup = document.getElementById('btnPopup') as HTMLButtonElement;
  const gamepadStatus = document.getElementById('gamepadStatus') as HTMLElement;
  const gamepadIndicator = document.getElementById('gamepadIndicator') as HTMLElement;

  const titleScreen = document.getElementById('titleScreen') as HTMLElement;
  const setupScreen = document.getElementById('setupScreen') as HTMLElement;
  const setupGrid = document.getElementById('setupGrid') as HTMLElement;
  const setupValidationMsg = document.getElementById('setupValidationMsg') as HTMLElement;
  const btnStartSetup = document.getElementById('btnStartSetup') as HTMLButtonElement;
  const btnBackToTitle = document.getElementById('btnBackToTitle') as HTMLButtonElement;
  const btnBattleStart = document.getElementById('btnBattleStart') as HTMLButtonElement;

  const charList = Object.values(CHARACTERS);
  const draftSlots = game.playerSlots.map((s) => ({ ...s }));
  let setupFocus = 0; // 0..3: player slots, 4: back to title, 5: battle start
  let showPadFocus = false;

  const setSlotControl = (idx: number, nextCtrl: '1P' | 'COM' | 'OFF') => {
    if (nextCtrl === '1P') {
      draftSlots.forEach((other, oIdx) => {
        if (oIdx !== idx && other.control === '1P') {
          other.control = 'COM';
        }
      });
    }
    draftSlots[idx].control = nextCtrl;
  };

  const stepSlotChar = (idx: number, dir: number) => {
    const slot = draftSlots[idx];
    const charIdx = Math.max(
      0,
      charList.findIndex((c) => c.charId === slot.charId)
    );
    const nextIdx = (charIdx + dir + charList.length) % charList.length;
    slot.charId = charList[nextIdx].charId;
  };

  const renderSetupGrid = () => {
    setupGrid.innerHTML = '';
    const activeCount = draftSlots.filter((s) => s.control !== 'OFF').length;
    if (activeCount < 2) {
      setupValidationMsg.textContent = '2人以上参加させてください';
      btnBattleStart.disabled = true;
    } else {
      setupValidationMsg.textContent = '';
      btnBattleStart.disabled = false;
    }

    btnBackToTitle.classList.toggle('pad-focused', showPadFocus && setupFocus === 4);
    btnBattleStart.classList.toggle('pad-focused', showPadFocus && setupFocus === 5);

    draftSlots.forEach((slot, idx) => {
      const charIdx = Math.max(
        0,
        charList.findIndex((c) => c.charId === slot.charId)
      );
      const charInfo = charList[charIdx] || charList[0];

      const portraitImg = assets.getImage(`portrait_${charInfo.charId}` as any);
      const portraitSrc = portraitImg
        ? portraitImg.src
        : `assets/images/characters/${charInfo.folder || charInfo.charId}/idle.png`;

      const slotEl = document.createElement('div');
      const isFocused = showPadFocus && setupFocus === idx;
      slotEl.className = `setup-slot ${slot.control === 'OFF' ? 'is-off' : ''} ${isFocused ? 'pad-focused' : ''}`;
      slotEl.style.borderColor = slot.control === 'OFF' ? '#334155' : charInfo.accentColor;

      slotEl.innerHTML = `
        <div class="setup-slot-top">
          <span class="setup-slot-label">PLAYER ${idx + 1}</span>
          <div class="control-toggle-group">
            <button type="button" class="ctrl-btn ${slot.control === '1P' ? 'active-1p' : ''}" data-ctrl="1P">1P</button>
            <button type="button" class="ctrl-btn ${slot.control === 'COM' ? 'active-com' : ''}" data-ctrl="COM">COM</button>
            <button type="button" class="ctrl-btn ${slot.control === 'OFF' ? 'active-off' : ''}" data-ctrl="OFF">OFF</button>
          </div>
        </div>
        <div class="setup-char-row">
          <img src="${portraitSrc}" alt="${charInfo.jpName}" class="setup-portrait" />
          <div class="setup-char-details">
            <div class="setup-char-selector">
              <button type="button" class="char-nav-btn" data-dir="-1">◀</button>
              <span class="setup-char-name">${charInfo.jpName}</span>
              <button type="button" class="char-nav-btn" data-dir="1">▶</button>
            </div>
            <div class="setup-skill-mini">${charInfo.skillName}</div>
            <div class="setup-skill-mini" style="color: #38bdf8;">${charInfo.ultraName}</div>
          </div>
        </div>
      `;

      slotEl.querySelectorAll<HTMLButtonElement>('.ctrl-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          showPadFocus = false;
          setSlotControl(idx, btn.dataset.ctrl as '1P' | 'COM' | 'OFF');
          renderSetupGrid();
        });
      });

      slotEl.querySelectorAll<HTMLButtonElement>('.char-nav-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          showPadFocus = false;
          const dir = parseInt(btn.dataset.dir || '1', 10);
          stepSlotChar(idx, dir);
          renderSetupGrid();
        });
      });

      setupGrid.appendChild(slotEl);
    });
  };

  const showTitleScreen = () => {
    titleScreen.classList.remove('hidden');
    setupScreen.classList.add('hidden');
    game.showTitle();
  };

  const showSetupScreen = () => {
    titleScreen.classList.add('hidden');
    setupScreen.classList.remove('hidden');
    setupFocus = 0;
    showPadFocus = game.input.getConnectedGamepads().some((p) => p.connected);
    game.showSetup();
    renderSetupGrid();
  };

  const startBattleFromSetup = () => {
    titleScreen.classList.add('hidden');
    setupScreen.classList.add('hidden');
    game.setPlayerSlots(draftSlots);
    game.startGame();
  };

  btnStartSetup.addEventListener('click', showSetupScreen);
  btnBackToTitle.addEventListener('click', showTitleScreen);
  btnBattleStart.addEventListener('click', startBattleFromSetup);
  btnTitle.addEventListener('click', showTitleScreen);
  btnSetup.addEventListener('click', showSetupScreen);

  window.addEventListener('keydown', (e) => {
    if (game.state === 'TITLE' && (e.code === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      showSetupScreen();
    }
  });

  // Gamepad navigation for Title & Setup screens
  game.onMenuInput = (input: MenuInput) => {
    const hasInput =
      input.dx !== 0 ||
      input.dy !== 0 ||
      input.confirm ||
      input.cancel ||
      input.alt ||
      input.prevChar ||
      input.nextChar ||
      input.start;

    if (!hasInput) return;

    if (game.state === 'TITLE') {
      if (input.confirm || input.start) {
        showPadFocus = true;
        showSetupScreen();
      }
      return;
    }

    if (game.state === 'SETUP') {
      showPadFocus = true;

      if (input.cancel) {
        showTitleScreen();
        return;
      }
      if (input.start) {
        if (!btnBattleStart.disabled) {
          startBattleFromSetup();
        }
        return;
      }

      // 2x2 grid (0..3) + footer buttons (4: Back, 5: Battle Start)
      if (input.dx !== 0) {
        if (setupFocus % 2 === 0 && input.dx > 0) setupFocus += 1;
        else if (setupFocus % 2 === 1 && input.dx < 0) setupFocus -= 1;
      }
      if (input.dy !== 0) {
        const nextFocus = setupFocus + input.dy * 2;
        if (nextFocus >= 0 && nextFocus <= 5) {
          setupFocus = nextFocus;
        }
      }

      if (setupFocus >= 0 && setupFocus <= 3) {
        if (input.confirm || input.nextChar) {
          stepSlotChar(setupFocus, 1);
        } else if (input.prevChar) {
          stepSlotChar(setupFocus, -1);
        } else if (input.alt) {
          const order: Array<'1P' | 'COM' | 'OFF'> = ['1P', 'COM', 'OFF'];
          const cur = draftSlots[setupFocus].control;
          const next = order[(order.indexOf(cur) + 1) % order.length];
          setSlotControl(setupFocus, next);
        }
      } else if (setupFocus === 4) {
        if (input.confirm) {
          showTitleScreen();
          return;
        }
      } else if (setupFocus === 5) {
        if (input.confirm && !btnBattleStart.disabled) {
          startBattleFromSetup();
          return;
        }
      }

      renderSetupGrid();
    }
  };

  // Render player cards
  const updatePlayerCards = (stats: GameStats) => {
    hudPlayers.innerHTML = '';
    game.players.forEach((p) => {
      const card = document.createElement('div');
      card.className = `player-card ${p.isAlive ? '' : 'dead'}`;
      card.style.borderLeft = `4px solid ${p.config.accentColor}`;

      const stars = '⭐'.repeat(stats.scores[p.config.id] || 0);
      const gaugePct = Math.min(100, (p.ultraGauge / 10) * 100);
      const isUltraReady = p.ultraGauge >= 10;

      card.innerHTML = `
        <div class="player-card-header">
          <span class="p-name" style="color: ${p.config.accentColor}">${p.config.name}</span>
          <span class="p-score">${stars}</span>
        </div>
        <div class="p-stats">
          <span class="p-stat-item" title="Bombs">💣${p.maxBombs}</span>
          <span class="p-stat-item" title="Fire Power">🔥${p.power}</span>
          <span class="p-stat-item" title="Speed">👟${p.speed.toFixed(1)}</span>
          ${p.hasKick ? '<span class="p-stat-item" title="Kick">🥊</span>' : ''}
          ${p.shield > 0 ? `<span class="p-stat-item" title="Shield">🛡️${p.shield}</span>` : ''}
        </div>
        <div title="超技ゲージ: ${p.ultraGauge}/10 (ボム設置で+1)" style="width: 100%; height: 4px; background: #0f172a; border-radius: 2px; overflow: hidden; margin-top: 2px;">
          <div style="width: ${gaugePct}%; height: 100%; background: ${isUltraReady ? '#ef4444' : '#38bdf8'}; box-shadow: ${isUltraReady ? '0 0 6px #ef4444' : 'none'}; transition: width 0.15s ease;"></div>
        </div>
      `;
      hudPlayers.appendChild(card);
    });
  };

  // Stats Callback
  game.onStatsChange = (stats: GameStats) => {
    const mins = Math.floor(stats.timeRemaining / 60);
    const secs = stats.timeRemaining % 60;
    timerBadge.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

    if (stats.timeRemaining <= 45 && stats.timeRemaining > 0) {
      timerBadge.classList.add('hurry');
    } else {
      timerBadge.classList.remove('hurry');
    }

    updatePlayerCards(stats);
  };

  // Gamepad update callback
  const updateGamepadUI = (pads: GamepadInfo[]) => {
    const activePad = pads.find((p) => p.connected);
    if (activePad) {
      gamepadIndicator.classList.add('active');
      gamepadStatus.classList.add('connected');
      const vibrationTag = activePad.hasVibration
        ? game.input.vibrationEnabled
          ? ' [Vibration ON]'
          : ' [Vibration OFF]'
        : '';
      gamepadStatus.innerHTML = `<span>🎮 Gamepad Connected: <strong>${activePad.id.slice(0, 24)}...</strong>${vibrationTag}</span>`;
    } else {
      gamepadIndicator.classList.remove('active');
      gamepadStatus.classList.remove('connected');
      gamepadStatus.innerHTML = `<span>🎮 Gamepad: Not connected (Keyboard: WASD / Space / E)</span>`;
    }
  };

  game.input.onGamepadChange = updateGamepadUI;

  // Initial check for already connected gamepads
  setTimeout(() => {
    const pads = game.input.getConnectedGamepads();
    updateGamepadUI(pads);
  }, 300);

  // Button Controls
  btnBgm.addEventListener('click', () => {
    const isPlaying = sounds.toggleBGM();
    btnBgm.textContent = isPlaying ? '🎵 BGM: ON' : '🎵 BGM: OFF';
    btnBgm.style.borderColor = isPlaying ? 'var(--accent-emerald)' : '#334155';
  });

  btnSfx.addEventListener('click', () => {
    const isMuted = sounds.toggleMute();
    btnSfx.textContent = isMuted ? '🔇 SE: OFF' : '🔊 SE: ON';
    btnSfx.style.borderColor = isMuted ? 'var(--accent-rose)' : '#334155';
  });

  btnVibration?.addEventListener('click', () => {
    const enabled = game.input.toggleVibration();
    btnVibration.textContent = enabled ? '📳 振動: ON' : '📴 振動: OFF';
    btnVibration.style.borderColor = enabled ? '#334155' : 'var(--accent-rose)';
    updateGamepadUI(game.input.getConnectedGamepads());
  });

  btnReset.addEventListener('click', () => {
    if (game.state === 'TITLE' || game.state === 'SETUP') {
      startBattleFromSetup();
    } else {
      game.startRound();
    }
  });

  // Fullscreen toggle
  const updateFullscreenBtn = () => {
    if (!btnFullscreen) return;
    const isFs = Boolean(document.fullscreenElement);
    btnFullscreen.textContent = isFs ? '✕ 解除' : '⛶ 全画面';
    btnFullscreen.style.borderColor = isFs ? 'var(--accent-cyan)' : '#334155';
  };

  btnFullscreen?.addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore fullscreen errors if blocked by browser/iframe policy
    }
  });
  document.addEventListener('fullscreenchange', updateFullscreenBtn);

  // Popup Window mode
  const isPopup =
    new URLSearchParams(window.location.search).get('popup') === '1' ||
    Boolean(window.opener && window.opener !== window);

  if (isPopup) {
    document.body.classList.add('popup-mode');
    if (btnPopup) btnPopup.style.display = 'none';
  }

  btnPopup?.addEventListener('click', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('popup', '1');
    const win = window.open(
      url.toString(),
      'ai_bomberman_popup',
      'width=820,height=860,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes'
    );
    if (!win) {
      alert('ポップアップがブロックされました。ブラウザのポップアップ許可設定をご確認ください。');
    } else {
      win.focus();
    }
  });

  // Mobile On-Screen Controls
  const bindTouch = (elemId: string, keyCode: string) => {
    const el = document.getElementById(elemId);
    if (!el) return;
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: keyCode }));
    });
    el.addEventListener('touchend', (e) => {
      e.preventDefault();
      window.dispatchEvent(new KeyboardEvent('keyup', { code: keyCode }));
    });
  };

  bindTouch('btnUp', 'ArrowUp');
  bindTouch('btnDown', 'ArrowDown');
  bindTouch('btnLeft', 'ArrowLeft');
  bindTouch('btnRight', 'ArrowRight');
  bindTouch('btnBombTouch', 'Space');
  bindTouch('btnSkillTouch', 'KeyE');
  bindTouch('btnUltraTouch', 'KeyQ');

  // Start on Title Screen -> Player Setup -> Battle
  showTitleScreen();
  game.startLoop();
});
