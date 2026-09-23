"use client";

import { useEffect, useRef } from "react";

export interface OutreachOrbProps {
  /** Contatos na cadência (nós indigo) */
  inSequence: number;
  /** Follow-ups aguardando (nós âmbar) */
  waiting: number;
  /** Respostas recebidas (nós rosa) */
  replies: number;
  /** Concluídos (nós verdes) */
  completed: number;
}

const COLOR_IN_SEQ = 0x6366f1;
const COLOR_WAITING = 0xf59e0b;
const COLOR_REPLIES = 0xec4899;
const COLOR_DONE = 0x10b981;

const MAX_NODES = 160;

/**
 * Esfera de distribuição: cada nó representa 1 contato real do painel
 * (1 nó por contato, limitado a 160 para performance). Arraste para girar;
 * com prefers-reduced-motion a rotação automática fica desligada.
 */
export function OutreachOrb({ inSequence, waiting, replies, completed }: OutreachOrbProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const countsRef = useRef<OutreachOrbProps>({ inSequence, waiting, replies, completed });
  countsRef.current = { inSequence, waiting, replies, completed };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const THREE = await import("three");
      if (disposed || !mountRef.current) return;

      const width = mount.clientWidth || 320;
      const height = mount.clientHeight || 280;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
      camera.position.set(0, 0, 4.2);

      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        return; // sem WebGL: o card mostra apenas a legenda numérica real
      }
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      mount.appendChild(renderer.domElement);
      renderer.domElement.style.cursor = "grab";

      const group = new THREE.Group();
      scene.add(group);

      // Distribuição de nós na esfera (espiral de Fibonacci)
      const counts = countsRef.current;
      const segments: { n: number; color: number }[] = [
        { n: counts.inSequence, color: COLOR_IN_SEQ },
        { n: counts.waiting, color: COLOR_WAITING },
        { n: counts.replies, color: COLOR_REPLIES },
        { n: counts.completed, color: COLOR_DONE },
      ];
      const total = segments.reduce((acc, s) => acc + s.n, 0);
      const scaled = total > MAX_NODES
        ? segments.map((s) => ({ ...s, n: Math.max(1, Math.round((s.n / total) * MAX_NODES)) }))
        : segments;
      const nodeCount = scaled.reduce((acc, s) => acc + s.n, 0);
      const radius = 1.35;

      const sphereGeometry = new THREE.SphereGeometry(0.055, 12, 12);
      let index = 0;
      for (const seg of scaled) {
        const material = new THREE.MeshBasicMaterial({ color: seg.color });
        for (let i = 0; i < seg.n; i++) {
          const y = 1 - (index / Math.max(nodeCount - 1, 1)) * 2;
          const r = Math.sqrt(Math.max(0, 1 - y * y));
          const theta = index * 2.399963; // ângulo áureo
          const point = new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r).multiplyScalar(radius);
          const mesh = new THREE.Mesh(sphereGeometry, material);
          mesh.position.copy(point);
          group.add(mesh);
          index++;
        }
      }

      // Anel guia discreto (órbita)
      const ringGeometry = new THREE.RingGeometry(radius + 0.28, radius + 0.3, 96);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0xc7cbf5,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = Math.PI / 2.4;
      scene.add(ring);

      // Arraste para girar (pointer events, sem tocar no estado do React)
      let targetRotY = 0;
      let targetRotX = 0.25;
      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      const el = renderer.domElement;

      const onPointerDown = (e: PointerEvent) => {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        el.style.cursor = "grabbing";
        el.setPointerCapture(e.pointerId);
      };
      const onPointerMove = (e: PointerEvent) => {
        if (!dragging) return;
        targetRotY += (e.clientX - lastX) * 0.008;
        targetRotX += (e.clientY - lastY) * 0.006;
        targetRotX = Math.max(-1.1, Math.min(1.1, targetRotX));
        lastX = e.clientX;
        lastY = e.clientY;
      };
      const onPointerUp = () => {
        dragging = false;
        el.style.cursor = "grab";
      };
      el.addEventListener("pointerdown", onPointerDown);
      el.addEventListener("pointermove", onPointerMove);
      el.addEventListener("pointerup", onPointerUp);
      el.addEventListener("pointerleave", onPointerUp);

      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let frame = 0;
      const tick = () => {
        if (!reduceMotion && !dragging) targetRotY += 0.0035;
        group.rotation.y += (targetRotY - group.rotation.y) * 0.12;
        group.rotation.x += (targetRotX - group.rotation.x) * 0.12;
        ring.rotation.z += reduceMotion ? 0 : 0.0012;
        renderer.render(scene, camera);
        frame = requestAnimationFrame(tick);
      };
      tick();

      const onResize = () => {
        if (!mountRef.current) return;
        const w = mountRef.current.clientWidth || width;
        const h = mountRef.current.clientHeight || height;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener("resize", onResize);

      cleanup = () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("resize", onResize);
        el.removeEventListener("pointerdown", onPointerDown);
        el.removeEventListener("pointermove", onPointerMove);
        el.removeEventListener("pointerup", onPointerUp);
        el.removeEventListener("pointerleave", onPointerUp);
        sphereGeometry.dispose();
        ringGeometry.dispose();
        ringMaterial.dispose();
        group.children.forEach((child) => {
          const mesh = child as import("three").Mesh;
          mesh.material instanceof THREE.Material && mesh.material.dispose();
        });
        renderer.dispose();
        el.remove();
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return (
    <div className="relative h-full w-full" ref={mountRef} role="img" aria-label="Esfera de distribuição de contatos por status" />
  );
}
