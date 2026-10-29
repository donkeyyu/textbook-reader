import { useEffect, useRef, useState, type RefObject } from 'react';
import { Application, Color, Container, Graphics, Text, Sprite as PixiSprite, Texture } from 'pixi.js';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
  type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { typeMarkerPaths } from '../supplements/supplement-types';
import { spacedText } from '../text/text-spacing';
import type { GraphNode, GraphEdge } from './project-graph.ts';

type LayoutNode = SimulationNodeDatum & GraphNode & { radius: number };
type LayoutEdge = SimulationLinkDatum<LayoutNode> & Pick<GraphEdge, 'kind'>;
type Sprite = { node: LayoutNode; dot: Container; circle: Graphics; icon: PixiSprite; label: Text };
type Point = { x: number; y: number };
export type GraphPreviewAnchor = Point & { key: string; radius: number };
const minZoom = .1;
const maxZoom = 3;
const minRadius = 4;
const maxRadius = 10;

// Reference: family-tree/frontend/src/hooks/usePixiGraph.ts. No content is mutated.
export function useSupplementGraph(host: RefObject<HTMLDivElement | null>, nodes: GraphNode[], edges: GraphEdge[],
  selectedKey: string | null, visible: boolean, onSelect: (key: string | null) => boolean) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [scale, setScale] = useState(1);
  const [preview, setPreview] = useState<GraphPreviewAnchor | null>(null);
  const app = useRef<Application | null>(null);
  const world = useRef<Container | null>(null);
  const sprites = useRef(new Map<string, Sprite>());
  const simulation = useRef<Simulation<LayoutNode, LayoutEdge> | null>(null);
  const current = useRef({ nodes, edges, selectedKey, visible, onSelect });
  current.current = { nodes, edges, selectedKey, visible, onSelect };
  const actions = useRef({ reveal: (_key: string) => {}, focus: (_key: string) => {}, fit: () => {}, zoom: (_factor: number) => {},
    pan: (_x: number, _y: number) => {}, paint: (_immediate = false) => {}, pause: () => {}, resume: () => {}, update: () => {} });
  const skipFocus = useRef<string | null>(null);
  const revealTarget = useRef<string | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let initializedApp = false;
    const renderer = new Application();
    void renderer.init({ backgroundAlpha: 0, antialias: true, autoStart: false, resolution: window.devicePixelRatio || 1,
      autoDensity: true, width: Math.max(1, element.clientWidth), height: Math.max(1, element.clientHeight) }).then(() => {
      initializedApp = true;
      if (disposed) { renderer.destroy(true, { children: true }); return; }
      app.current = renderer;
      world.current = new Container();
      renderer.stage.addChild(world.current);
      renderer.canvas.setAttribute('aria-hidden', 'true');
      element.appendChild(renderer.canvas);
      setReady(true);
    }).catch(() => { if (!disposed) setError('节点图暂时无法绘制。请刷新页面重试；解读仍可从教材打开。'); });
    return () => {
      disposed = true;
      simulation.current?.stop();
      if (initializedApp) renderer.destroy(true, { children: true });
      app.current = null; world.current = null; sprites.current.clear(); initialized.current = false;
    };
  }, [host]);

  useEffect(() => {
    const renderer = app.current;
    const container = world.current;
    const element = host.current;
    if (!ready || !renderer || !container || !element) return;
    let layout: LayoutNode[] = [];
    let links: LayoutEdge[] = [];
    const adjacency = new Map<string, Set<string>>();
    const colors = new Map<string, string>();
    const style = getComputedStyle(element);
    function themeColor(name: string, fallback: number) {
      try { return new Color(style.getPropertyValue(name).trim() || fallback).toNumber(); }
      catch { return fallback; }
    }
    const labelColor = themeColor('--graph-label-color', 0x6e6e73);
    const labelFocusColor = themeColor('--graph-label-focus-color', 0x1d1d1f);
    const edgeColor = themeColor('--graph-edge-color', 0xb8bec6);
    const edgeFocusColor = themeColor('--graph-edge-focus-color', 0x57606a);
    element.closest('.supplement-graph')?.querySelectorAll<HTMLElement>('.graph-legend [data-supplement-type]').forEach((item) => {
      colors.set(item.dataset.supplementType!, getComputedStyle(item).getPropertyValue('--type-color').trim());
    });
    // Five shared textures, created once per renderer lifetime. Panning and zooming
    // only update sprites; no DOM icons or SVG rasterization in the frame loop.
    const iconTextures = new Map<string, Texture>();
    for (const [type, path] of Object.entries(typeMarkerPaths)) {
      if (type === 'group') continue;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const context = canvas.getContext('2d')!;
      context.scale(64 / 32, 64 / 32);
      context.fillStyle = '#fffdf3';
      context.beginPath(); context.arc(16, 16, 15, 0, Math.PI * 2); context.fill();
      context.strokeStyle = colors.get(type) || '#0066cc';
      context.lineWidth = 1.5; context.stroke();
      context.translate(4, 4);
      context.lineWidth = 1.8; context.lineCap = 'round'; context.lineJoin = 'round';
      context.stroke(new Path2D(path));
      iconTextures.set(type, Texture.from(canvas));
    }
    const lines = new Graphics();
    const dots = new Container();
    const labels = new Container();
    container.addChild(lines, dots, labels);
    const next = sprites.current;
    let topology = '';
    let initialOverview = false;
    let initialSelection: string | null = null;
    function colorSprite({ node, circle, icon }: Sprite) {
      const color = colors.get(node.type) || '#0066cc';
      circle.clear().circle(0, 0, node.radius).fill(color);
      icon.texture = iconTextures.get(node.type)!;
    }
    function update() {
      const state = current.current;
      // Keep default direction/multiplicity and personal unordered pairs. Input
      // order and display properties do not change the forces acting on nodes.
      const signature = JSON.stringify([state.nodes.map((node) => node.key).sort(), state.edges.map(({ source, target, kind }) =>
        JSON.stringify(kind === 'personal' ? [kind, ...[source, target].sort()] : [kind, source, target])).sort()]);
      if (signature === topology) {
        let changed = false;
        for (const node of state.nodes) {
          const sprite = next.get(node.key)!;
          if (sprite.node.title !== node.title) { sprite.node.title = node.title; changed = true; }
          if (sprite.node.type !== node.type) { sprite.node.type = node.type; colorSprite(sprite); changed = true; }
        }
        if (changed) paint(true);
        return;
      }
      const keys = new Set(state.nodes.map((node) => node.key));
      if (gesture?.node && !keys.has(gesture.node.key)) cancelGesture();
      if (hoverCandidate && !keys.has(hoverCandidate)) clearHover();
      for (const [key, sprite] of next) {
        if (keys.has(key)) continue;
        dots.removeChild(sprite.dot).destroy({ children: true });
        labels.removeChild(sprite.label).destroy();
        next.delete(key);
      }
      adjacency.clear();
      const center = initialized.current ? container!.toLocal({ x: renderer!.screen.width / 2, y: renderer!.screen.height / 2 }) : { x: 0, y: 0 };
      layout = state.nodes.map((node, index) => {
        const sprite = next.get(node.key);
        if (sprite) {
          sprite.node.title = node.title;
          sprite.node.type = node.type;
          return sprite.node;
        }
        const angle = index * Math.PI * (3 - Math.sqrt(5));
        const distance = initialized.current ? 48 : 48 * Math.sqrt(index + 1);
        return { key: node.key, title: node.title, type: node.type, radius: minRadius,
          x: center.x + Math.cos(angle) * distance, y: center.y + Math.sin(angle) * distance };
      });
      const byKey = new Map(layout.map((node) => [node.key, node]));
      links = state.edges.filter((edge) => byKey.has(edge.source) && byKey.has(edge.target)).map((edge) => ({ ...edge }));
      for (const { source, target } of state.edges) {
        if (source === target || !byKey.has(source) || !byKey.has(target)) continue;
        if (!adjacency.has(source)) adjacency.set(source, new Set());
        if (!adjacency.has(target)) adjacency.set(target, new Set());
        adjacency.get(source)!.add(target); adjacency.get(target)!.add(source);
      }
      for (const node of layout) {
        node.radius = minRadius + Math.min(maxRadius - minRadius, 1.2 * Math.sqrt(adjacency.get(node.key)?.size ?? 0));
        const retained = next.get(node.key);
        if (retained) { colorSprite(retained); continue; }
        const dot = new Container(), circle = new Graphics();
        const icon = new PixiSprite(iconTextures.get(node.type)!);
        icon.anchor.set(.5);
        dot.addChild(circle, icon);
        const label = new Text({ text: spacedText(node.title), style: { fontFamily: 'system-ui, sans-serif', fontSize: 12,
          fontWeight: '300', lineHeight: 17, fill: 0xffffff, wordWrap: false, wordWrapWidth: 140, breakWords: true },
          resolution: Math.max(2, window.devicePixelRatio || 1) });
        label.anchor.set(.5, 0);
        const sprite = { node, dot, circle, icon, label };
        colorSprite(sprite); dots.addChild(dot); labels.addChild(label); next.set(node.key, sprite);
      }
      // Retained nodes keep their velocity and drag pins. Clear links before
      // d3 initializes the latest node set so removed endpoints cannot linger.
      linkForce.links([]); force.nodes(layout); linkForce.links(links);
      force.alpha(Math.max(force.alpha(), initialized.current ? .16 : 1));
      topology = signature;
      resume();
    }
    let hovered: string | null = null;
    let hoverCandidate: string | null = null;
    let hoverTimer = 0;
    let hoverPoint: Point | null = null;
    let control = false;
    let renderFrame = 0;
    function paint(immediate = false) {
      if (!current.current.visible) return;
      if (immediate) {
        cancelAnimationFrame(renderFrame); renderFrame = 0;
        draw();
        return;
      }
      if (renderFrame) return;
      renderFrame = requestAnimationFrame(() => {
        renderFrame = 0;
        if (current.current.visible) draw();
      });
    }
    function draw() {
      const zoom = container!.scale.x;
      const selected = next.has(current.current.selectedKey ?? '') ? current.current.selectedKey : null;
      const focused = hovered ?? selected;
      const previewKey = control ? hovered : null;
      const neighbors = focused ? adjacency.get(focused) : undefined;
      const showsIcon = (node: LayoutNode) => node.key === selected || node.key === hovered ||
        node.radius * zoom * 2 >= 16;
      const displayRadius = (node: LayoutNode) => showsIcon(node) ? Math.max(node.radius, 10 / zoom) : node.radius;
      lines.clear();
      // Batch by source and emphasis; personal pairs have no arrowhead.
      for (const kind of ['default', 'personal'] as const) for (const active of [false, true]) {
        lines.beginPath();
        for (const link of links) {
          if (link.kind !== kind) continue;
          const source = link.source as LayoutNode;
          const target = link.target as LayoutNode;
          if ((source.key === focused || target.key === focused) !== active) continue;
          const dx = target.x! - source.x!, dy = target.y! - source.y!;
          const length = Math.hypot(dx, dy);
          const sourceRadius = displayRadius(source), targetRadius = displayRadius(target);
          if (length < sourceRadius + targetRadius + 4) continue;
          const startX = source.x! + dx / length * (sourceRadius + 2);
          const startY = source.y! + dy / length * (sourceRadius + 2);
          const endX = target.x! - dx / length * (targetRadius + 2);
          const endY = target.y! - dy / length * (targetRadius + 2);
          lines.moveTo(startX, startY);
          if (kind === 'personal') {
            const bend = Math.min(18 / zoom, length / 5);
            lines.quadraticCurveTo((source.x! + target.x!) / 2 - dy / length * bend,
              (source.y! + target.y!) / 2 + dx / length * bend, endX, endY);
            continue;
          }
          lines.lineTo(endX, endY);
          const arrow = 5 / zoom;
          const angle = Math.atan2(dy, dx);
          lines.moveTo(endX - Math.cos(angle - .45) * arrow, endY - Math.sin(angle - .45) * arrow)
            .lineTo(endX, endY).lineTo(endX - Math.cos(angle + .45) * arrow, endY - Math.sin(angle + .45) * arrow);
        }
        lines.stroke({ width: (active ? 1.5 : 1) / zoom,
          color: kind === 'personal' ? colors.get('personal') || '#b13d65' : active ? edgeFocusColor : edgeColor,
          alpha: active ? .8 : focused ? .12 : .45 });
      }
      const occupied: { x: number; y: number; width: number; height: number }[] = [];
      const rank = (key: string) => key === hovered ? 5 : key === selected ? 4 : neighbors?.has(key) ? 1 : 0;
      const ordered = [...next.values()].sort((a, b) => rank(b.node.key) - rank(a.node.key));
      for (const { node, dot, circle, icon, label } of ordered) {
        const active = node.key === selected || node.key === hovered;
        const emphasized = active || !!neighbors?.has(node.key);
        const clear = !focused || node.key === focused || neighbors?.has(node.key);
        dot.alpha = label.alpha = clear ? 1 : .15;
        label.tint = node.key === focused ? labelFocusColor : labelColor;
        dot.position.set(node.x!, node.y!);
        const showIcon = showsIcon(node);
        const visualRadius = displayRadius(node);
        circle.visible = !showIcon;
        icon.visible = showIcon;
        // Fixed-size textures need only a transform, not width/height bookkeeping.
        if (showIcon) icon.scale.set(visualRadius / 32);
        const x = node.x! * zoom + container!.x, y = node.y! * zoom + container!.y + visualRadius * zoom + 5;
        const screenRadius = visualRadius * zoom;
        const centerY = node.y! * zoom + container!.y;
        dot.visible = x + screenRadius >= 0 && x - screenRadius <= renderer!.screen.width &&
          centerY + screenRadius >= 0 && centerY - screenRadius <= renderer!.screen.height;
        const within = x > -220 && x < renderer!.screen.width + 220 && y > -100 && y < renderer!.screen.height;
        label.visible = within && (emphasized || zoom >= .8);
        if (!label.visible) continue;
        const fullTitle = active;
        const limit = 10;
        label.text = fullTitle || node.title.length <= limit ? node.title : `${node.title.slice(0, limit)}…`;
        label.style.wordWrap = fullTitle;
        label.style.wordWrapWidth = fullTitle ? 160 : 140;
        label.scale.set(1 / zoom);
        const above = node.key === previewKey;
        label.anchor.set(.5, above ? 1 : 0);
        label.position.set(node.x!, node.y! + (above ? -1 : 1) * (visualRadius + 5 / zoom));
        const bounds = { x: x - label.width * zoom / 2,
          y: above ? node.y! * zoom + container!.y - visualRadius * zoom - 5 - label.height * zoom : y,
          width: label.width * zoom, height: label.height * zoom };
        const overlaps = () => occupied.some((box) => bounds.x < box.x + box.width + 6 && bounds.x + bounds.width + 6 > box.x &&
          bounds.y < box.y + box.height + 6 && bounds.y + bounds.height + 6 > box.y);
        if (emphasized && node.key !== focused && overlaps()) {
          const belowY = bounds.y;
          bounds.y = node.y! * zoom + container!.y - visualRadius * zoom - 5 - bounds.height;
          if (overlaps()) bounds.y = belowY;
          else {
            label.anchor.y = 1;
            label.y = node.y! - visualRadius - 5 / zoom;
          }
        }
        if (!above && node.key === hovered && node.key !== selected && overlaps()) {
          const shift = Math.max(...occupied.map((box) => box.y + box.height)) + 6 - bounds.y;
          bounds.y += shift; label.y += shift / zoom;
        }
        if (!emphasized && overlaps()) label.visible = false;
        else occupied.push(bounds);
      }
      renderer!.render();
      const node = previewKey ? next.get(previewKey)?.node : null;
      const rect = node ? canvas.getBoundingClientRect() : null;
      const anchor = node && rect ? { key: node.key, x: rect.left + node.x! * zoom + container!.x,
        y: rect.top + node.y! * zoom + container!.y, radius: Math.max(node.radius * zoom, 10) } : null;
      setPreview((previous) => previous?.key === anchor?.key && previous?.x === anchor?.x &&
        previous?.y === anchor?.y && previous?.radius === anchor?.radius ? previous : anchor);
    }
    let revealFrame = 0;
    function cancelReveal() {
      cancelAnimationFrame(revealFrame); revealFrame = 0; revealTarget.current = null;
    }
    function reveal(key: string) {
      cancelReveal(); initialOverview = false; skipFocus.current = key; revealTarget.current = key;
      let settledFrames = 0;
      function step() {
        if (revealTarget.current !== key) return;
        const node = next.get(key)?.node;
        if (!node) { cancelReveal(); return; }
        const bounds = canvas.getBoundingClientRect();
        const directory = element!.closest('.supplement-graph')?.querySelector('#graph-directory')?.getBoundingClientRect();
        const padding = 20;
        const right = Math.max(padding, renderer!.screen.width - padding);
        const bottom = Math.max(padding, renderer!.screen.height - padding);
        const x = node.x! * container!.scale.x + container!.x;
        const y = node.y! * container!.scale.y + container!.y;
        let target = { x: Math.max(padding, Math.min(right, x)), y: Math.max(padding, Math.min(bottom, y)) };
        if (directory) {
          const obstacle = { left: directory.left - bounds.left - padding, right: directory.right - bounds.left + padding,
            top: directory.top - bounds.top - padding, bottom: directory.bottom - bounds.top + padding };
          if (target.x > obstacle.left && target.x < obstacle.right && target.y > obstacle.top && target.y < obstacle.bottom) {
            const candidates = [{ x: obstacle.left, y: target.y }, { x: obstacle.right, y: target.y },
              { x: target.x, y: obstacle.top }, { x: target.x, y: obstacle.bottom }]
              .filter((point) => point.x >= padding && point.x <= right && point.y >= padding && point.y <= bottom);
            candidates.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
            target = candidates[0] ?? target;
          }
        }
        container!.x += target.x - x;
        container!.y += target.y - y;
        paint(true);
        const animating = element!.closest('.reading-layout')?.getAnimations().some((animation) => animation.playState === 'running');
        settledFrames = animating ? 0 : settledFrames + 1;
        if (settledFrames < 3) revealFrame = requestAnimationFrame(step);
        else { revealFrame = 0; revealTarget.current = null; }
      }
      revealFrame = requestAnimationFrame(step);
    }
    function transform(zoom: number, point: Point = { x: renderer!.screen.width / 2, y: renderer!.screen.height / 2 }) {
      cancelReveal(); initialOverview = false;
      const nextZoom = Math.max(minZoom, Math.min(maxZoom, zoom));
      const local = container!.toLocal(point);
      container!.scale.set(nextZoom);
      container!.position.set(point.x - local.x * nextZoom, point.y - local.y * nextZoom);
      setScale(nextZoom); paint();
    }
    function focus(key: string) {
      cancelReveal(); initialOverview = false;
      const node = next.get(key)?.node;
      if (!node) return;
      const zoom = Math.max(1.2, container!.scale.x);
      container!.scale.set(zoom);
      container!.position.set(renderer!.screen.width / 2 - node.x! * zoom, renderer!.screen.height / 2 - node.y! * zoom);
      setScale(zoom); paint();
    }
    function fit(automatic = false) {
      if (!automatic) { cancelReveal(); initialOverview = false; }
      if (!layout.length) return;
      const xs = layout.map((node) => node.x!), ys = layout.map((node) => node.y!);
      const left = Math.min(...xs) - 90, top = Math.min(...ys) - 90;
      const width = Math.max(...xs) - left + 90, height = Math.max(...ys) - top + 90;
      const zoom = Math.max(minZoom, Math.min(renderer!.screen.width / width, renderer!.screen.height / height, 1.2));
      container!.scale.set(zoom);
      container!.position.set((renderer!.screen.width - width * zoom) / 2 - left * zoom,
        (renderer!.screen.height - height * zoom) / 2 - top * zoom);
      setScale(zoom); paint();
    }
    const linkForce = forceLink<LayoutNode, LayoutEdge>([]).id((node) => node.key).distance(160).strength(.45);
    const force = forceSimulation<LayoutNode>([])
      .force('link', linkForce)
      .force('charge', forceManyBody<LayoutNode>().strength(-260).distanceMax(460))
      .force('collision', forceCollide<LayoutNode>(32).strength(1).iterations(2))
      .force('x', forceX(0).strength(.004)).force('y', forceY(0).strength(.004))
      .alphaDecay(.04).velocityDecay(.45).on('tick', () => {
        if (initialOverview && initialSelection !== current.current.selectedKey) initialOverview = false;
        if (initialOverview) fit(true);
        paint();
      }).on('end', () => { initialOverview = false; }).stop();
    simulation.current = force;
    function resume() {
      if (!current.current.visible) return;
      if (!layout.length) { force.stop().alphaTarget(0).alpha(0); paint(true); return; }
      if (!initialized.current) {
        // Show the graph after a short warm-up; finish settling between frames.
        force.tick(4);
        initialSelection = current.current.selectedKey;
        initialOverview = true;
        fit(true);
        skipFocus.current = current.current.selectedKey;
        initialized.current = true;
      }
      if (force.alpha() >= force.alphaMin()) force.restart();
      // Data replacement must reach the same canvas before the browser presents it.
      paint(true);
    }
    const canvas = renderer.canvas;
    let gesture: { pointer: number; start: Point; last: Point; node?: LayoutNode; offset: Point; moved: boolean } | null = null;
    function point(event: PointerEvent | WheelEvent): Point {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }
    function hit(p: Point) {
      let nearest: LayoutNode | undefined;
      let distance = Infinity;
      for (const { node } of next.values()) {
        const gap = Math.hypot(node.x! * container!.scale.x + container!.x - p.x, node.y! * container!.scale.y + container!.y - p.y);
        if (gap < Math.max(12, node.radius * container!.scale.x + 3) && gap < distance) { distance = gap; nearest = node; }
      }
      return nearest;
    }
    function down(event: PointerEvent) {
      if (event.button !== 0 || gesture) return;
      cancelReveal(); initialOverview = false;
      const p = point(event), node = hit(p), local = container!.toLocal(p);
      gesture = { pointer: event.pointerId, start: p, last: p, node, moved: false,
        offset: { x: (node?.x ?? local.x) - local.x, y: (node?.y ?? local.y) - local.y } };
      clearHover();
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
    }
    function move(event: PointerEvent) {
      const p = point(event);
      if (!gesture) {
        const nextHover = hit(p)?.key ?? null;
        const pointerMoved = !hoverPoint || p.x !== hoverPoint.x || p.y !== hoverPoint.y;
        hoverPoint = p;
        if (control !== event.ctrlKey) { control = event.ctrlKey; paint(); }
        if (nextHover !== hoverCandidate || (pointerMoved && !hovered && nextHover)) {
          clearTimeout(hoverTimer); hoverTimer = 0;
          hoverCandidate = nextHover; hovered = null;
          canvas.style.cursor = nextHover ? 'pointer' : 'grab'; paint();
          if (nextHover) hoverTimer = window.setTimeout(() => {
            if (hoverCandidate !== nextHover) return;
            hoverTimer = 0;
            if (!current.current.visible || gesture || !hoverPoint || hit(hoverPoint)?.key !== nextHover) {
              clearHover();
              return;
            }
            hovered = nextHover; paint(true);
          }, 800);
        }
        return;
      }
      if (gesture.pointer !== event.pointerId) return;
      if (Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) > 5) gesture.moved = true;
      if (gesture.node && gesture.moved) {
        const local = container!.toLocal(p), node = gesture.node;
        node.x = node.fx = local.x + gesture.offset.x;
        node.y = node.fy = local.y + gesture.offset.y;
        node.vx = node.vy = 0;
        force.alpha(Math.max(force.alpha(), .18)).alphaTarget(.28).restart();
      } else if (!gesture.node) { container!.x += p.x - gesture.last.x; container!.y += p.y - gesture.last.y; }
      gesture.last = p; paint();
    }
    function up(event: PointerEvent) {
      if (!gesture || gesture.pointer !== event.pointerId) return;
      const finished = gesture; gesture = null;
      if (finished.node) {
        finished.node.fx = finished.node.fy = null;
        if (finished.moved) {
          force.alphaTarget(0).alpha(.18);
          if (current.current.visible) force.restart();
        }
        else if (event.type === 'pointerup') {
          skipFocus.current = finished.node.key;
          if (!current.current.onSelect(finished.node.key)) skipFocus.current = null;
        }
      }
      if (!finished.node && !finished.moved && event.type === 'pointerup') current.current.onSelect(null);
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      canvas.style.cursor = 'grab'; paint();
    }
    function wheel(event: WheelEvent) {
      event.preventDefault(); clearHover();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? renderer!.screen.height : 1;
      const speed = event.ctrlKey ? .01 : .0025;
      transform(container!.scale.x * Math.exp(-event.deltaY * unit * speed), point(event));
    }
    function clearHover() {
      clearTimeout(hoverTimer); hoverTimer = 0; hoverCandidate = null; hoverPoint = null;
      if (!gesture) canvas.style.cursor = 'grab';
      hovered = null; control = false; setPreview(null); paint();
    }
    function leave() { if (!gesture) clearHover(); }
    function modifier(event: KeyboardEvent) {
      if (control !== event.ctrlKey) { control = event.ctrlKey; paint(true); }
    }
    function visibility() { if (document.hidden) clearHover(); }
    function cancelGesture() {
      const interrupted = gesture;
      gesture = null;
      if (interrupted?.node) { interrupted.node.fx = interrupted.node.fy = null; force.alphaTarget(0); }
      if (interrupted && canvas.hasPointerCapture(interrupted.pointer)) canvas.releasePointerCapture(interrupted.pointer);
      canvas.style.cursor = 'grab';
    }
    function pause() {
      cancelReveal(); initialOverview = false;
      clearHover(); cancelGesture();
      force.stop(); cancelAnimationFrame(renderFrame); renderFrame = 0;
    }
    actions.current = { reveal, focus, fit, zoom: (factor) => transform(container.scale.x * factor),
      pan: (x, y) => { cancelReveal(); initialOverview = false; container.x += x; container.y += y; paint(); }, paint, pause, resume, update };
    update();
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up); canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('pointerleave', leave);
    // Track the modifier even when the focused editor consumes key events.
    window.addEventListener('keydown', modifier, true); window.addEventListener('keyup', modifier, true);
    window.addEventListener('blur', clearHover); document.addEventListener('visibilitychange', visibility);
    return () => {
      pause();
      for (const child of container.removeChildren()) child.destroy({ children: true });
      next.clear(); simulation.current = null;
      for (const texture of iconTextures.values()) texture.destroy(true);
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('lostpointercapture', up); canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('pointerleave', leave);
      window.removeEventListener('keydown', modifier, true); window.removeEventListener('keyup', modifier, true);
      window.removeEventListener('blur', clearHover); document.removeEventListener('visibilitychange', visibility);
    };
  }, [ready, host]);

  useEffect(() => { actions.current.update(); }, [nodes, edges, ready]);

  useEffect(() => {
    if (selectedKey && skipFocus.current !== selectedKey && ready) actions.current.focus(selectedKey);
    skipFocus.current = null;
    actions.current.paint();
  }, [selectedKey, ready]);

  useEffect(() => {
    const element = host.current;
    const renderer = app.current;
    const container = world.current;
    if (!ready || !element || !renderer || !container) return;
    const observer = new ResizeObserver(() => {
      const width = element.clientWidth, height = element.clientHeight;
      if (!width || !height) return;
      if (!revealTarget.current) {
        container.x += (width - renderer.screen.width) / 2;
        container.y += (height - renderer.screen.height) / 2;
      }
      // WebGL resize clears the drawing buffer. Redraw in this observer turn,
      // before presentation, rather than leaving a black frame until the next rAF.
      renderer.renderer.resize(width, height); actions.current.paint(true);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready, host]);

  useEffect(() => {
    if (visible) actions.current.resume();
    else actions.current.pause();
  }, [visible, ready]);

  return { ready, error, scale, preview, reveal: (key: string) => actions.current.reveal(key), focus: (key: string) => actions.current.focus(key), fit: () => actions.current.fit(),
    zoom: (factor: number) => actions.current.zoom(factor), pan: (x: number, y: number) => actions.current.pan(x, y) };
}
