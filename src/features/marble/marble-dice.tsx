'use client';

import { useEffect, useRef, useState } from 'react';
import { MARBLE_DICE_FACES, MARBLE_DICE_PIPS, MARBLE_DICE_RADIUS, MARBLE_DICE_SETTLED_AT, MARBLE_DICE_VIEW, marbleDiceProgress, marbleDiceValues, marbleDiePose } from './marble-dice-motion';
import styles from './marble-dice.module.css';

export type MarbleDiceSceneProps = { dice: number[]; progress: number; seed: string; reduced?: boolean };

type Frame = { dice: number[]; progress: number; seed: string; reduced: boolean };

export function MarbleDiceScene({ dice, progress, seed, reduced = false }: MarbleDiceSceneProps) {
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const update = useRef<(() => void) | null>(null);
  const values = marbleDiceValues(dice);
  const [systemReduced, setSystemReduced] = useState(false);
  const [ready, setReady] = useState(false);
  const effectiveReduced = reduced || systemReduced;
  const amount = marbleDiceProgress(progress);
  const settled = effectiveReduced || amount >= MARBLE_DICE_SETTLED_AT;
  const label = values.length ? `주사위 ${values.join(', ')}` : '주사위 없음';
  const valueKey = values.join(',');
  const latest = useRef<Frame>({ dice: values, progress: amount, seed, reduced: effectiveReduced });

  useEffect(() => {
    latest.current = { dice: valueKey ? valueKey.split(',').map(Number) : [], progress: amount, seed, reduced: effectiveReduced };
    update.current?.();
  }, [valueKey, amount, seed, effectiveReduced]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setSystemReduced(query.matches);
    changed();
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);

  useEffect(() => {
    const host = root.current;
    const surface = viewport.current;
    if (!host || !surface) return;
    let disposed = false;
    let initializing = false;
    let failures = 0;
    let attempts = 0;
    let probes = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let draw: (() => void) | undefined;
    let release: (() => void) | undefined;

    const diagnose = (status: string, error?: unknown) => {
      if (disposed) return;
      host.dataset.diceStatus = status;
      host.dataset.diceAttempts = String(attempts);
      if (error !== undefined) host.dataset.diceError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    };
    const visible = () => {
      if (disposed || document.hidden || !host.isConnected) return false;
      const rect = host.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
        && rect.top < window.innerHeight && rect.left < window.innerWidth
        && host.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false;
    };
    // Import completion and opacity/transform changes need not produce another
    // observer event. Bounded startup probes close that lost-wakeup window.
    const scheduleProbe = () => {
      const delays = [60, 180, 420, 900, 1800];
      if (disposed || draw || failures >= 3 || retryTimer !== undefined || probes >= delays.length) return;
      retryTimer = setTimeout(() => { retryTimer = undefined; refresh(); }, delays[probes++]);
    };
    const fail = (error: unknown, phase: string) => {
      if (disposed) return;
      failures += 1;
      diagnose(`${phase}-failed`, error);
      release?.();
      release = undefined;
      setReady(false);
      scheduleProbe();
    };

    const setup = async () => {
      if (initializing || failures >= 3 || draw || !visible()) return;
      initializing = true;
      attempts += 1;
      let phase = 'import';
      diagnose('loading');
      const resources: { dispose(): void }[] = [];
      let renderer: import('three').WebGLRenderer | undefined;
      let detach: (() => void) | undefined;
      release = () => {
        draw = undefined;
        detach?.();
        resources.forEach(resource => resource.dispose());
        renderer?.dispose();
        renderer?.forceContextLoss();
        renderer?.domElement.remove();
      };
      const own = <T extends { dispose(): void },>(resource: T): T => { resources.push(resource); return resource; };

      try {
        const THREE = await import('three');
        const { RoundedBoxGeometry } = await import('three/addons/geometries/RoundedBoxGeometry.js');
        if (!visible()) { diagnose('waiting-visible'); return; }
        phase = 'context';
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
        const webgl = renderer;
        webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        webgl.setSize(MARBLE_DICE_VIEW.width, MARBLE_DICE_VIEW.height, false);
        webgl.setClearColor(0x000000, 0);
        webgl.outputColorSpace = THREE.SRGBColorSpace;
        webgl.toneMapping = THREE.ACESFilmicToneMapping;
        webgl.toneMappingExposure = 1;
        webgl.shadowMap.enabled = true;
        webgl.shadowMap.type = THREE.PCFShadowMap;
        webgl.domElement.setAttribute('aria-hidden', 'true');
        surface.appendChild(webgl.domElement);

        phase = 'scene';
        const scene = new THREE.Scene();
        const { verticalSpan, width, height } = MARBLE_DICE_VIEW;
        const halfHeight = verticalSpan / 2;
        const halfWidth = halfHeight * width / height;
        const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 0.1, 40);
        camera.position.fromArray(MARBLE_DICE_VIEW.position);
        camera.lookAt(...MARBLE_DICE_VIEW.target);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x839da2, 1.65));
        const key = new THREE.DirectionalLight(0xfffaf2, 2.8);
        key.position.set(-3, 7, 8);
        key.castShadow = true;
        key.shadow.mapSize.set(512, 512);
        Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 20 });
        key.shadow.normalBias = 0.012;
        key.shadow.bias = -0.0002;
        own(key.shadow);
        scene.add(key);
        const fill = new THREE.DirectionalLight(0xd7edff, 0.7);
        fill.position.set(4, 3, -4);
        scene.add(fill);

        const faceMaterial = (value: number, primary: boolean) => {
          const color = document.createElement('canvas');
          const depth = document.createElement('canvas');
          color.width = color.height = depth.width = depth.height = 256;
          const ink = color.getContext('2d');
          const bump = depth.getContext('2d');
          if (!ink || !bump) throw new Error('Dice texture context unavailable');
          ink.fillStyle = primary ? '#fffdf8' : '#d6e5e7'; ink.fillRect(0, 0, 256, 256);
          bump.fillStyle = '#ffffff'; bump.fillRect(0, 0, 256, 256);
          for (const pip of MARBLE_DICE_PIPS[value]) {
            const x = 64 + (pip % 3) * 64, y = 64 + Math.floor(pip / 3) * 64;
            const radius = value === 1 ? 30 : 23;
            ink.beginPath(); ink.arc(x, y, radius, 0, Math.PI * 2);
            ink.fillStyle = primary ? '#102c35' : '#607c82'; ink.fill();
            const well = bump.createRadialGradient(x, y, radius * 0.65, x, y, radius + 1);
            well.addColorStop(0, '#222222'); well.addColorStop(0.7, '#686868'); well.addColorStop(1, '#ffffff');
            bump.beginPath(); bump.arc(x, y, radius + 1, 0, Math.PI * 2); bump.fillStyle = well; bump.fill();
          }
          const map = own(new THREE.CanvasTexture(color));
          map.colorSpace = THREE.SRGBColorSpace;
          const bumpMap = own(new THREE.CanvasTexture(depth));
          return own(new THREE.MeshPhysicalMaterial({ map, bumpMap, bumpScale: 0.025, roughness: 0.4, metalness: 0, clearcoat: 0.16, clearcoatRoughness: 0.35 }));
        };
        const resultMaterials = MARBLE_DICE_FACES.map(value => faceMaterial(value, true));
        const sideMaterials = MARBLE_DICE_FACES.map(value => faceMaterial(value, false));
        const geometry = own(new RoundedBoxGeometry(1, 1, 1, 4, MARBLE_DICE_RADIUS));
        const diceMeshes = [0, 1].map(() => {
          const mesh = new THREE.Mesh(geometry, [...sideMaterials]);
          mesh.castShadow = true;
          scene.add(mesh);
          return mesh;
        });
        const floorGeometry = own(new THREE.PlaneGeometry(10, 7));
        const floorMaterial = own(new THREE.ShadowMaterial({ color: 0x24313c, opacity: 0.16 }));
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);

        const contactCanvas = document.createElement('canvas');
        contactCanvas.width = contactCanvas.height = 128;
        const contact = contactCanvas.getContext('2d');
        if (!contact) throw new Error('Dice shadow context unavailable');
        const gradient = contact.createRadialGradient(64, 64, 10, 64, 64, 62);
        gradient.addColorStop(0, '#17212ddd'); gradient.addColorStop(0.45, '#17212d77'); gradient.addColorStop(1, '#17212d00');
        contact.fillStyle = gradient; contact.fillRect(0, 0, 128, 128);
        const contactTexture = own(new THREE.CanvasTexture(contactCanvas));
        contactTexture.colorSpace = THREE.SRGBColorSpace;
        const contactGeometry = own(new THREE.PlaneGeometry(1.65, 1.65));
        const shadows = diceMeshes.map(() => {
          const material = own(new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, depthWrite: false, toneMapped: false }));
          const mesh = new THREE.Mesh(contactGeometry, material);
          mesh.rotation.x = -Math.PI / 2;
          mesh.position.y = 0.003;
          scene.add(mesh);
          return mesh;
        });

        let contextLost = false;
        let lastKey = '';
        draw = () => {
          if (!visible() || contextLost) return;
          const frame = latest.current;
          const reducedMotion = frame.reduced || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          const p = reducedMotion ? 1 : Math.min(frame.progress, MARBLE_DICE_SETTLED_AT);
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const frameKey = JSON.stringify([frame.dice, p, frame.seed, dpr]);
          if (lastKey === frameKey) return;
          if (webgl.getPixelRatio() !== dpr) webgl.setPixelRatio(dpr);
          diceMeshes.forEach((mesh, index) => {
            const shown = index < frame.dice.length;
            mesh.visible = shadows[index].visible = shown;
            if (!shown) return;
            const pose = marbleDiePose({ value: frame.dice[index], index, count: frame.dice.length, progress: p, seed: frame.seed, reduced: reducedMotion });
            for (let face = 0; face < MARBLE_DICE_FACES.length; face += 1) {
              mesh.material[face] = MARBLE_DICE_FACES[face] === frame.dice[index] ? resultMaterials[face] : sideMaterials[face];
            }
            mesh.position.fromArray(pose.position);
            mesh.quaternion.fromArray(pose.quaternion);
            shadows[index].position.set(pose.position[0], 0.003, pose.position[2]);
            shadows[index].scale.setScalar(pose.shadowScale);
            shadows[index].material.opacity = pose.shadowOpacity;
          });
          try {
            webgl.render(scene, camera);
            if (webgl.getContext().isContextLost()) return;
            lastKey = frameKey;
            diagnose('ready');
            clearTimeout(retryTimer);
            retryTimer = undefined;
            setReady(true);
          } catch (error) {
            fail(error, 'render');
          }
        };
        const lost = (event: Event) => {
          event.preventDefault();
          contextLost = true;
          lastKey = '';
          diagnose('context-lost');
          if (!disposed) setReady(false);
        };
        const restored = () => { contextLost = false; lastKey = ''; draw?.(); };
        webgl.domElement.addEventListener('webglcontextlost', lost);
        webgl.domElement.addEventListener('webglcontextrestored', restored);
        detach = () => {
          webgl.domElement.removeEventListener('webglcontextlost', lost);
          webgl.domElement.removeEventListener('webglcontextrestored', restored);
        };
        draw();
      } catch (error) {
        fail(error, phase);
      } finally {
        initializing = false;
        scheduleProbe();
      }
    };

    const refresh = () => {
      if (visible()) { if (draw) draw(); else void setup(); }
      else if (!draw && !initializing && failures === 0) diagnose('waiting-visible');
      scheduleProbe();
    };
    update.current = refresh;
    const intersection = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(refresh);
    intersection?.observe(host);
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(refresh);
    resize?.observe(host);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('resize', refresh);
    refresh();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      update.current = null;
      intersection?.disconnect();
      resize?.disconnect();
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('resize', refresh);
      release?.();
    };
  }, []);

  return <div ref={root} className={styles.scene} role="img" aria-label={label} data-marble-dice="true" data-dice={valueKey}
    data-renderer={ready ? 'webgl' : 'fallback'} data-settled={settled} data-reduced={effectiveReduced}>
    <div ref={viewport} className={styles.viewport} aria-hidden="true" />
    {!ready ? <div className={styles.fallback} aria-hidden="true">{values.map((value, index) => <div className={styles.die} key={index} data-face={value}>
      {Array.from({ length: 9 }, (_, pip) => <i className={styles.pip} key={pip} data-pip={MARBLE_DICE_PIPS[value].includes(pip)} />)}
    </div>)}</div> : null}
  </div>;
}
