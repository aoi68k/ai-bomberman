// Entry point and UI coordinator for AI-Bomberman

import './style.css';
import { GameManager, GameStats } from './game';
import { sounds } from './audio';
import { GamepadInfo } from './input';
import { assets } from './assets';
import { CHARACTERS } from './constants';

document.addEventListener('DOMContentLoaded', async () => {
  const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
  if (!canvas) return;

  // Preload any custom PNG assets in public/assets/images/
  await assets.loadAll();

  const game = new GameManager(canvas);

  // UI Elements
  const timerBadge = document.getElementById('timerBadge') as HTMLElement;
  const btnBgm = document.getElementById('btnBgm') as HTMLButtonElement;
  const btnSfx = document.getElementById('btnSfx') as HTMLButtonElement;
  const btnReset = document.getElementById('btnReset') as HTMLButtonElement;
  const selComCount = document.getElementById('selComCount') as HTMLSelectElement;
  const gamepadStatus = document.getElementById('gamepadStatus') as HTMLElement;
  const gamepadIndicator = document.getElementById('gamepadIndicator') as HTMLElement;
  const btnCharSelect = document.getElementById('btnCharSelect') as HTMLButtonElement;
  const charModal = document.getElementById('charModal') as HTMLElement;
  const btnCloseModal = document.getElementById('btnCloseModal') as HTMLButtonElement;
  const charGrid = document.getElementById('charGrid') as HTMLElement;

  // Character Select Modal Setup
  const openModal = () => {
    charModal.classList.remove('hidden');
    renderCharGrid();
  };

  const closeModal = () => {
    charModal.classList.add('hidden');
  };

  btnCharSelect.addEventListener('click', openModal);
  btnCloseModal.addEventListener('click', closeModal);
  charModal.addEventListener('click', (e) => {
    if (e.target === charModal) closeModal();
  });

  const renderCharGrid = () => {
    charGrid.innerHTML = '';
    const charList = Object.values(CHARACTERS).map((c) => ({
      id: c.charId,
      name: c.jpName,
      role: c.role,
      skill: c.skillName,
      desc: c.skillDesc,
    }));

    charList.forEach((c) => {
      const isSelected = game.selectedCharId === c.id;
      const card = document.createElement('div');
      card.className = `char-card ${isSelected ? 'selected' : ''}`;

      const portraitImg = assets.getImage(`portrait_${c.id}` as any);
      const portraitSrc = portraitImg ? portraitImg.src : `/assets/images/characters/${c.id}/idle.png`;

      card.innerHTML = `
        <img src="${portraitSrc}" alt="${c.name}" class="char-portrait" />
        <div class="char-info">
          <div class="char-name-row">
            <span class="char-name">${c.name}</span>
            <span class="char-role">${c.role}</span>
          </div>
          <div class="char-skill-name">${c.skill}</div>
          <div class="char-skill-desc">${c.desc}</div>
        </div>
      `;

      card.addEventListener('click', () => {
        game.selectCharacter(c.id);
        game.startRound();
        closeModal();
      });

      charGrid.appendChild(card);
    });
  };

  // Render player cards
  const updatePlayerCards = (stats: GameStats) => {
    hudPlayers.innerHTML = '';
    game.players.forEach((p, idx) => {
      const card = document.createElement('div');
      card.className = `player-card ${p.isAlive ? '' : 'dead'}`;
      card.style.borderLeft = `4px solid ${p.config.accentColor}`;

      const stars = '⭐'.repeat(stats.scores[p.config.id] || 0);

      const skillSecs = Math.ceil(p.skillCooldownTimer / 60);
      const skillText = p.skillCooldownTimer > 0 ? `⏳ ${skillSecs}s` : `⚡ READY`;
      const skillColor = p.skillCooldownTimer > 0 ? '#94a3b8' : '#10b981';

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
        <div style="font-size: 0.72rem; color: ${skillColor}; font-weight: 700; margin-top: 2px;">
          ${skillText}
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
      const vibrationTag = activePad.hasVibration ? ' [Vibration ON]' : '';
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

  btnReset.addEventListener('click', () => {
    game.startRound();
  });

  selComCount.addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement;
    game.setComCount(parseInt(target.value, 10));
    game.startRound();
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

  // Start the game loop & match
  game.startGame();
  game.startLoop();
});
