import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { bookTitle, getPage, pageCount, pages, pageLabel, resolvePageInput } from "../textbook/catalog";
import { getLocation } from "../textbook/supplements";
import { bookId, nodeKey, supplementQueries } from '../textbook/content';
import type { PersonalData, PersonalSupplement } from './personal';
import type { BookContent } from './useBookContent';
import { AccountControl } from './AccountControl';
import { LoadingToast } from './LoadingToast';
import { LegacyCopies } from './LegacyCopies';
import { signIn, signInWithPassword, signOut } from './supabase';
import { MarkdownEditor } from './MarkdownEditor';
import { PanelResize } from './PanelResize';
import { PersonalPanel } from './PersonalPanel';
import { PersonalLibrary } from './PersonalLibrary';
import { RegionSelector } from './RegionSelector';
import { supplementTypes, supplementType, TypeMarker, type SupplementType } from './supplement-types';
import { readingPage, restoredScroll, type PageMetric } from "./session";
import { groupMarkers } from "./marker-groups";
import { loadReadingPosition, saveReadingPosition } from "./reading-record";
import { SupplementPanel, SupplementPreview, type PreviewAnchor } from "./Supplement";
import { ContentSearch } from './ContentSearch';
import { SupplementGraph, GraphRelated } from './graph/SupplementGraph';
import type { LinkBinding } from './links/document';
import type { LinkContext } from './links/LinkContent';
import { Backlinks } from './links/Backlinks';
import { projectReferences } from './links/project-references';
import { SplitResize, useReadingViews } from './split/ReadingViews';
import { usePanelLayout } from './split/usePanelLayout';

type ReadingContext = {
  page: number;
  fraction: number;
  supplementId: string | null;
  choiceIds: string[] | null;
  locationId: string | null;
  focusId: string;
  panelScroll: number;
  methodOpenIds: string[];
};
type Jump = { page: number; locationId?: string; source?: ReadingContext; restore?: ReadingContext; keepHistory?: boolean;
  locate?: { fraction?: number; focusId: string; panelScroll: number } };
type Commit = { page: number; fraction?: number; locationId?: string; focusId: string; panelScroll?: number };

function measurePages(list: HTMLDivElement): PageMetric[] {
  return Array.from(list.children, (child) => {
    const page = child as HTMLElement;
    return { top: list.offsetTop + page.offsetTop, height: page.offsetHeight };
  });
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d={direction === "left" ? "m14 6-6 6 6 6" : "m10 6 6 6-6 6"} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function PageImage({ page }: { page: (typeof pages)[number] }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return <>
    <img className="page-image" src={`${page.image}${attempt ? `?retry=${attempt}` : ""}`} alt={page.alt}
      width={page.width} height={page.height} loading={page.page === 1 ? "eager" : "lazy"} decoding="async"
      style={{ visibility: failed ? "hidden" : undefined }} onError={() => setFailed(true)} onLoad={() => setFailed(false)} />
    {failed && <div className="page-error" role="alert"><span>第 {page.page} 页暂时无法加载</span>
      <button className="text-button" onClick={() => { setFailed(false); setAttempt(attempt + 1); }}>重试</button>
    </div>}
  </>;
}

export function Reader({ content, onReturnToShelf, navigationNotice = '' }: { content: BookContent; onReturnToShelf: (notice: string) => void; navigationNotice?: string }) {
  const [resume] = useState(() => {
    try { return { position: loadReadingPosition(), error: '' }; }
    catch (cause) { return { position: null, error: (cause as Error).message }; }
  });
  const [readingError, setReadingError] = useState(resume.error);
  const ownsPersonal = !!content.user && content.personal?.userId === content.user.id && !content.draftOwner;
  const personal: PersonalData = ownsPersonal ? content.personal!.data : { supplements: [], notes: {} };
  const references = useMemo(() => projectReferences(bookId, content.nodes, personal), [content.nodes, personal]);
  const { getSupplement, supplementsForPage } = useMemo(() => supplementQueries(content.published ?? {
    documentSha256: bookId, pageCount, chapters: [], sections: [], supplements: [],
  }), [content.published]);
  const storePersonal = content.updatePersonal;
  const [personalItem, setPersonalItem] = useState<PersonalSupplement | null>(null);
  const personalItemRef = useRef(personalItem);
  personalItemRef.current = personalItem;
  const [personalLibraryOpen, setPersonalLibraryOpen] = useState(false);
  const views = useReadingViews();
  const graphOpen = views.graphVisible;
  const [graphMounted, setGraphMounted] = useState(false);
  const [newChapterId, setNewChapterId] = useState<string | null | undefined>(undefined);
  const chapters = content.published?.chapters ?? [];
  const sections = content.published?.sections ?? [];
  const [selectionPage, setSelectionPage] = useState<number | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<SupplementType[]>([]);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  function saveNote(id: string, value: string, bindings: readonly LinkBinding[]) {
    return storePersonal((current) => {
      const notes = { ...current.notes };
      const noteBindings = { ...current.noteBindings };
      if (value.trim()) notes[id] = value;
      else delete notes[id];
      if (value.trim() && bindings.length) noteBindings[id] = bindings;
      else delete noteBindings[id];
      return { ...current, notes, ...(current.noteBindings || bindings.length ? { noteBindings } : {}) };
    });
  }
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("");
  const [pageError, setPageError] = useState("");
  const [editingPage, setEditingPage] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [searchTarget, setSearchTarget] = useState<{ key: string } | null>(null);
  const [navigationMode, setNavigationMode] = useState<'contents' | 'pages'>('contents');
  const { layoutRef, bottomPanel: panelBelow } = usePanelLayout(views.split, navigationOpen && views.bookVisible);
  const [supplementId, setSupplementId] = useState<string | null>(null);
  const [choiceIds, setChoiceIds] = useState<string[] | null>(null);
  const [methodOpenIds, setMethodOpenIds] = useState<string[]>([]);
  const [paperWidth, setPaperWidth] = useState(690);
  const [markerSize, setMarkerSize] = useState(() => window.matchMedia("(max-width: 760px)").matches ? 32 : 36);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [history, setHistory] = useState<ReadingContext[]>([]);
  const [groupPreview, setGroupPreview] = useState<string[] | null>(null);
  const [preview, setPreview] = useState<{ id: string; anchor: PreviewAnchor } | null>(null);
  const [commit, setCommit] = useState<Commit | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressPreviewFocus = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pageList = useRef<HTMLDivElement>(null);
  const thumbnailList = useRef<HTMLDivElement>(null);
  const metrics = useRef<PageMetric[]>([]);
  const anchor = useRef({ page: 1, fraction: 0 });
  const measureReading = useRef<(restore?: boolean) => void>(() => {});
  const flushReadingPosition = useRef<() => string>(() => '');
  const current = useRef(1);
  const requestId = useRef(0);
  const navigationPending = useRef(false);
  const retryJump = useRef<Jump>({ page: 1 });
  const toggleButton = useRef<HTMLButtonElement>(null);
  const previousAccount = useRef(content.user?.id);
  const selectedGraphKey = personalItem
    ? content.nodes.find((node) => node.source === 'personal' && node.id === personalItem.id)?.key ?? null
    : supplementId ? nodeKey({ bookId, source: 'default', id: supplementId }) : null;
  const links: LinkContext = { bookId, nodes: content.nodes, chapters, sections,
    chapterId: content.nodes.find((node) => node.key === selectedGraphKey)?.chapterId ?? null,
    onNavigate: (target) => { selectGraphNode(nodeKey(target)); },
    onCreate: async (item) => {
      await storePersonal((current) => ({ ...current, supplements: [...current.supplements.filter((value) => value.id !== item.id), item] }));
      return { bookId, source: 'personal', id: item.id };
    } };

  function backlinksFor(key: string) {
    return <Backlinks references={references.incoming.get(key) ?? []} catalog={links} onNavigate={links.onNavigate} disabled={pending} />;
  }

  function allowGraphSelection() {
    return !document.querySelector('[data-dirty="true"]') || window.confirm('有尚未保存的内容，放弃修改？');
  }

  function personalSelection(item: PersonalSupplement): PersonalSupplement {
    const node = content.nodes.find((node) => node.source === 'personal' && node.id === item.id);
    return { ...item, chapterId: item.chapterId === undefined ? node?.chapterId ?? null : item.chapterId,
      sectionId: item.sectionId === undefined ? node?.sectionId ?? null : item.sectionId };
  }

  function locateGraphNode(key: string | null, panelScroll = 0, preserveFocus = false) {
    const location = content.nodes.find((node) => node.key === key)?.location;
    if (!location) return;
    void navigate({ page: location.page, locationId: location.locationId ?? undefined,
      locate: { fraction: location.locationId ? undefined : location.region.y,
        focusId: preserveFocus ? '' : 'supplement-title', panelScroll } });
  }

  function selectGraphNode(key: string | null, preserveFocus = false) {
    if (key === null) {
      if (!allowGraphSelection()) return false;
      closeSupplement(false); setPersonalItem(null); setSelectionPage(null);
      keepPreview(); clearPreview();
      requestAnimationFrame(() => document.querySelector<HTMLElement>('.graph-viewport')?.focus({ preventScroll: true }));
      return true;
    }
    const node = content.nodes.find((item) => item.key === key);
    if (!node) return false;
    if (key === selectedGraphKey && !personalLibraryOpen) {
      if (graphOpen && views.bookVisible) locateGraphNode(key, views.capturePanelScroll(), preserveFocus);
      if (!preserveFocus) requestAnimationFrame(() => document.getElementById('supplement-title')?.focus({ preventScroll: true }));
      return true;
    }
    if (!allowGraphSelection()) return false;
    cancelJump(); keepPreview(); clearPreview();
    setPersonalLibraryOpen(false); setSelectionPage(null); setChoiceIds(null);
    setMethodOpenIds([]); setSelectedLocation(null); setHistory([]);
    setSupplementId(node.source === 'default' ? node.id : null);
    // A fresh selection must not share an old delete request's object identity.
    setPersonalItem(node.source === 'personal' ? personalSelection(node.personal) : null);
    if (graphOpen && views.bookVisible) locateGraphNode(key, 0, preserveFocus);
    requestAnimationFrame(() => {
      const panel = document.getElementById('supplement-panel');
      if (panel) panel.scrollTop = 0;
      if (!preserveFocus) document.getElementById('supplement-title')?.focus({ preventScroll: true });
    });
    return true;
  }

  function openGraph() {
    cancelJump(); keepPreview(); clearPreview(); setSelectionPage(null);
    setGraphMounted(true); views.show('graph', true);
    requestAnimationFrame(() => document.getElementById('graph-search-toggle')?.focus({ preventScroll: true }));
  }

  function closeGraph() {
    cancelJump(); keepPreview(); clearPreview();
    if (views.narrow) setNavigationOpen(false);
    views.show('book', true);
    requestAnimationFrame(() => document.getElementById('open-supplement-graph')?.focus({ preventScroll: true }));
  }

  useEffect(() => {
    if (previousAccount.current !== content.user?.id && !document.querySelector('[data-dirty="true"]')) {
      setPersonalItem(null);
      setPersonalLibraryOpen(false);
      setSelectionPage(null);
    }
    previousAccount.current = content.user?.id;
  }, [content.user?.id]);

  useLayoutEffect(() => {
    const element = scroller.current;
    const list = pageList.current;
    if (!element || !list) return;
    let frame = 0;
    let width = 0;
    let listTop = 0;
    let initialized = false;
    let layoutScrollTop: number | null = null;
    let storageError = resume.error;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;

    function savePosition() {
      clearTimeout(saveTimer);
      saveTimer = undefined;
      if (!initialized || storageError) return storageError;
      try { saveReadingPosition(anchor.current); }
      catch (cause) { storageError = (cause as Error).message; setReadingError(storageError); }
      return storageError;
    }

    function updatePosition() {
      // Hidden layout changes are not reading; keep the last visible anchor.
      if (!element || element.inert) return;
      const page = readingPage(metrics.current, element.scrollTop, element.clientHeight, element.scrollHeight);
      const metric = metrics.current[page - 1];
      current.current = page;
      setCurrentPage(page);
      if (metric) anchor.current = { page, fraction: (element.scrollTop - metric.top) / metric.height };
      if (initialized && !storageError && saveTimer === undefined) saveTimer = setTimeout(savePosition, 750);
    }

    function measure(restore = false) {
      if (!element || !list) return;
      const saved = anchor.current;
      const resized = width > 0 && (width !== list.clientWidth || listTop !== list.offsetTop);
      width = list.clientWidth;
      listTop = list.offsetTop;
      setPaperWidth(width);
      setMarkerSize(window.matchMedia("(max-width: 760px)").matches ? 32 : 36);
      metrics.current = measurePages(list);
      const metric = metrics.current[saved.page - 1];
      if (!initialized) {
        const position = resume.position;
        const initialMetric = position && metrics.current[position.page - 1];
        if (position && initialMetric) element.scrollTop = restoredScroll(initialMetric, position.fraction);
        initialized = true;
      } else if ((resized || restore) && metric) {
        element.scrollTop = restoredScroll(metric, saved.fraction);
        layoutScrollTop = element.scrollTop;
      }
      updatePosition();
    }

    function scroll() {
      if (element?.inert) return;
      const layoutScroll = layoutScrollTop !== null && Math.abs(element!.scrollTop - layoutScrollTop) < 1;
      layoutScrollTop = null;
      if (navigationPending.current && !layoutScroll) {
        requestId.current += 1;
        navigationPending.current = false;
        setPending(false);
        setError(null);
      }
      clearPreview();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePosition);
    }
    function flushPosition() {
      cancelAnimationFrame(frame);
      updatePosition();
      return savePosition();
    }
    function visibilityChanged() { if (document.visibilityState === "hidden") flushPosition(); }

    measureReading.current = measure;
    flushReadingPosition.current = flushPosition;
    measure();
    const observer = new ResizeObserver(() => measure());
    observer.observe(list);
    observer.observe(element);
    element.addEventListener("scroll", scroll, { passive: true });
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("pagehide", flushPosition);
    return () => {
      clearTimeout(saveTimer);
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("scroll", scroll);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("pagehide", flushPosition);
    };
  }, []);

  useLayoutEffect(() => {
    if (views.bookVisible) measureReading.current(true);
  }, [views.bookVisible]);

  useEffect(() => {
    if (selectionPage !== null) document.querySelector<HTMLElement>('.region-selector')?.focus({ preventScroll: true });
  }, [selectionPage]);

  useEffect(() => {
    if (!editingPage) {
      setPageInput(String(currentPage));
      setPageError("");
    }
    const list = thumbnailList.current;
    const selected = document.getElementById(`thumbnail-${currentPage}`);
    if (list && !list.hidden && selected) {
      if (selected.offsetTop < list.scrollTop) list.scrollTop = selected.offsetTop;
      else if (selected.offsetTop + selected.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = selected.offsetTop + selected.offsetHeight - list.clientHeight;
      }
    }
  }, [currentPage, navigationOpen, navigationMode, editingPage]);

  useLayoutEffect(() => {
    if (!commit || !scroller.current || !pageList.current) return;
    const element = scroller.current;
    metrics.current = measurePages(pageList.current);
    const metric = metrics.current[commit.page - 1];
    if (!metric) return;
    const padding = parseFloat(getComputedStyle(element).paddingTop);
    const location = commit.locationId ? getLocation(commit.locationId) : undefined;
    element.scrollTop = commit.fraction !== undefined
      ? restoredScroll(metric, commit.fraction)
      : metric.top + (location ? metric.height * location.region.y : 0) - padding;
    anchor.current = { page: commit.page, fraction: (element.scrollTop - metric.top) / metric.height };
    current.current = commit.page;
    setCurrentPage(commit.page);
    setPageInput(String(commit.page));
    setPageError("");
    const panel = document.getElementById("supplement-panel");
    const focused = document.getElementById(commit.focusId);
    focused?.focus({ preventScroll: true });
    if (panel && focused && commit.focusId.startsWith("choice-")) {
      const bounds = panel.getBoundingClientRect();
      const title = focused.getBoundingClientRect();
      if (title.top < bounds.top) panel.scrollTop += title.top - bounds.top;
      else if (title.bottom > bounds.bottom) panel.scrollTop += title.bottom - bounds.bottom;
    }
  }, [commit]);

  useEffect(() => {
    if (!commit) return;
    // Restore after child editors mount so their height cannot clamp the saved scroll.
    const panel = document.getElementById("supplement-panel");
    if (panel && commit.panelScroll !== undefined) panel.scrollTop = commit.panelScroll;
    setCommit(null);
  }, [commit]);

  useLayoutEffect(() => {
    const panel = document.getElementById("supplement-panel");
    const heading = panel?.querySelector<HTMLElement>(".supplement-heading");
    if (!panel || !heading) return;
    const measure = () => panel.style.setProperty("--heading-height", `${heading.offsetHeight}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(heading);
    measure();
    return () => observer.disconnect();
  }, [supplementId, choiceIds, personalItem, personalLibraryOpen]);

  useEffect(() => {
    const closePreview = () => clearPreview();
    window.addEventListener("resize", closePreview);
    return () => {
      requestId.current += 1;
      clearTimeout(previewTimer.current);
      window.removeEventListener("resize", closePreview);
    };
  }, []);

  function focusMarker(id: string) {
    suppressPreviewFocus.current = true;
    document.querySelector<HTMLButtonElement>(`[data-supplement-ids~="${id}"]`)?.focus({ preventScroll: true });
    suppressPreviewFocus.current = false;
  }
  function clearPreview() { setPreview(null); setGroupPreview(null); }
  function showGroupPreview(ids: string[]) {
    keepPreview();
    if (choiceIds?.some((id) => ids.includes(id))) { clearPreview(); return; }
    setPreview(null);
    setGroupPreview(ids);
  }
  function keepPreview() { clearTimeout(previewTimer.current); }
  function leavePreview() {
    keepPreview();
    previewTimer.current = setTimeout(() => clearPreview(), preview?.anchor.docked ? 500 : 180);
  }
  function showPreview(id: string, button: HTMLButtonElement) {
    keepPreview();
    if (supplementId === id) { clearPreview(); return; }
    setGroupPreview(null);
    const paper = button.closest(".paper")?.getBoundingClientRect();
    const reader = scroller.current?.getBoundingClientRect();
    if (!paper || !reader) return;
    const rightSpace = reader.right - paper.right - 24;
    const leftSpace = paper.left - reader.left - 24;
    const docked = Math.max(rightSpace, leftSpace) < 220;
    const onRight = rightSpace >= 220;
    const width = Math.min(280, onRight ? rightSpace : leftSpace);
    const buttonBounds = button.getBoundingClientRect();
    const maxHeight = docked ? Math.min(window.innerHeight * .35, reader.bottom - buttonBounds.bottom - 12) : undefined;
    if (maxHeight !== undefined && maxHeight < 64) { clearPreview(); return; }
    setPreview({ id, anchor: {
      top: buttonBounds.top,
      left: docked ? reader.left : onRight ? paper.right + 12 : paper.left - width - 12,
      width: docked ? reader.width : width, docked, maxHeight,
    } });
  }

  function cancelJump() {
    requestId.current += 1;
    navigationPending.current = false;
    setPending(false);
    setError(null);
  }

  function openSupplement(id: string) {
    setPersonalLibraryOpen(false);
    setPersonalItem(null);
    setSelectionPage(null);
    cancelJump();
    setMethodOpenIds([]);
    keepPreview();
    clearPreview();
    setChoiceIds(null);
    setSelectedLocation(getSupplement(id)!.locationId);
    setSupplementId(id);
    setHistory([]);
    if (getSupplement(id)!.questionGuide) {
      const location = getLocation(getSupplement(id)!.locationId);
      setCommit({ page: location.page, locationId: location.id, focusId: "supplement-title", panelScroll: 0 });
    }
    if (window.matchMedia("(max-width: 760px)").matches) setNavigationOpen(false);
    requestAnimationFrame(() => {
      const panel = document.getElementById("supplement-panel");
      if (panel) panel.scrollTop = 0;
      document.getElementById("supplement-title")?.focus({ preventScroll: true });
    });
  }

  function openChoices(ids: string[]) {
    setPersonalLibraryOpen(false);
    setPersonalItem(null);
    setSelectionPage(null);
    cancelJump();
    setMethodOpenIds([]);
    keepPreview();
    clearPreview();
    setSupplementId(null);
    setSelectedLocation(null);
    setHistory([]);
    setChoiceIds(ids);
    if (window.matchMedia("(max-width: 760px)").matches) setNavigationOpen(false);
    requestAnimationFrame(() => {
      const panel = document.getElementById("supplement-panel");
      if (panel) panel.scrollTop = 0;
      document.getElementById(`choice-${ids[0]}`)?.focus({ preventScroll: true });
    });
  }

  function openPersonalLibrary() {
    const selected = personalItem
      ? content.nodes.find((node) => node.source === 'personal' && node.id === personalItem.id)
      : content.nodes.find((node) => node.source === 'default' && node.id === supplementId);
    setNewChapterId(selected?.chapterId);
    closeSupplement(false); setPersonalItem(null); setSelectionPage(null); keepPreview(); clearPreview();
    setPersonalLibraryOpen(true);
    if (window.matchMedia('(max-width: 760px)').matches) setNavigationOpen(false);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.personal-search input')?.focus({ preventScroll: true }));
  }

  function openPersonal(item: PersonalSupplement) {
    closeSupplement(false); keepPreview(); clearPreview(); setSelectionPage(null);
    setPersonalItem(personalSelection(item));
    if (window.matchMedia('(max-width: 760px)').matches) setNavigationOpen(false);
    requestAnimationFrame(() => document.getElementById('supplement-title')?.focus({ preventScroll: true }));
  }

  function closePersonalLibrary() {
    setPersonalLibraryOpen(false);
    requestAnimationFrame(() => document.getElementById('add-personal-supplement')?.focus({ preventScroll: true }));
  }

  function selectAccordion(id: string | null) {
    setPersonalLibraryOpen(false);
    setPersonalItem(null);
    setSelectionPage(null);
    cancelJump();
    keepPreview();
    clearPreview();
    setMethodOpenIds([]);
    setSupplementId(id);
    const location = id ? getLocation(getSupplement(id)!.locationId) : undefined;
    setSelectedLocation(location?.id ?? null);
    if (location) setCommit({ page: location.page, locationId: location.id, focusId: `choice-${id}` });
  }

  function locateSupplement() {
    cancelJump(); keepPreview(); clearPreview();
    const panelScroll = views.capturePanelScroll();
    if (personalItem?.page !== null && personalItem?.region) {
      void navigate({ page: personalItem.page, locate: { fraction: personalItem.region.y, focusId: "locate-personal", panelScroll } });
    } else if (supplementId) {
      const location = getLocation(getSupplement(supplementId)!.locationId);
      void navigate({ page: location.page, locationId: location.id, locate: { focusId: "locate-supplement", panelScroll } });
    }
  }

  function closeSupplement(restoreFocus = true) {
    setPersonalLibraryOpen(false);
    cancelJump();
    setMethodOpenIds([]);
    const id = supplementId ?? choiceIds?.[0];
    setChoiceIds(null);
    setSupplementId(null);
    setSelectedLocation(null);
    setHistory([]);
    if (!restoreFocus) return;
    requestAnimationFrame(() => {
      if (graphOpen) { document.getElementById('graph-search-toggle')?.focus({ preventScroll: true }); return; }
      const marker = id ? document.querySelector(`[data-supplement-ids~="${id}"]`)?.getBoundingClientRect() : undefined;
      const viewport = scroller.current?.getBoundingClientRect();
      if (id && marker && viewport && marker.bottom > viewport.top && marker.top < viewport.bottom) focusMarker(id);
      else document.getElementById(views.bookVisible ? `page-${current.current}` : 'open-supplement-graph')?.focus({ preventScroll: true });
    });
  }

  function relatedJump(locationId: string, focusId: string) {
    const location = getLocation(locationId);
    if (locationId === selectedLocation) {
      if (views.open.graph) void navigate({ page: location.page, locationId, keepHistory: true });
      return;
    }
    const element = scroller.current;
    if (!element) return;
    const page = readingPage(metrics.current, element.scrollTop, element.clientHeight, element.scrollHeight);
    const metric = metrics.current[page - 1];
    if (!metric) return;
    void navigate({ page: location.page, locationId, source: {
      page, fraction: (element.scrollTop - metric.top) / metric.height,
      supplementId, choiceIds, methodOpenIds, locationId: selectedLocation, focusId,
      panelScroll: views.capturePanelScroll(),
    } });
  }

  async function navigate(jump: Jump) {
    const target = getPage(jump.page);
    const id = ++requestId.current;
    retryJump.current = jump;
    navigationPending.current = true;
    clearPreview();
    setPending(true);
    setError(null);
    try {
      const image = new Image();
      image.src = target.image;
      await image.decode();
      if (requestId.current !== id) return;
      // Only a loaded textbook target may change the visible reading views.
      views.show('book');
      if (jump.locate) {
        if (jump.locationId) setSelectedLocation(jump.locationId);
        setCommit({ page: jump.page, locationId: jump.locationId, ...jump.locate });
        return;
      }
      setPersonalItem(null); setPersonalLibraryOpen(false); setSelectionPage(null);
      setChoiceIds(jump.restore?.choiceIds ?? null);
      if (jump.source) setHistory((previous) => [...previous, jump.source!]);
      else if (!jump.restore && !jump.keepHistory) setHistory([]);
      if (jump.restore) {
        setHistory((previous) => previous.slice(0, -1));
        setSupplementId(jump.restore.supplementId);
        setMethodOpenIds(jump.restore.methodOpenIds);
        setSelectedLocation(jump.restore.locationId);
      } else {
        const note = jump.locationId ? supplementsForPage(jump.page).find((item) => item.locationId === jump.locationId) : undefined;
        if (!jump.locationId || note) setMethodOpenIds([]);
        // A textbook-only target keeps the source explanation and its return control.
        setSupplementId(note?.id ?? (jump.locationId ? supplementId : null));
        setSelectedLocation(jump.locationId ?? null);
      }
      setCommit({ page: jump.page, fraction: jump.restore?.fraction, locationId: jump.locationId, panelScroll: jump.restore?.panelScroll,
        focusId: jump.restore?.focusId ?? (jump.locationId ? `location-${jump.locationId}` : `page-${jump.page}`) });
    } catch {
      if (requestId.current === id) {
        setPageInput(String(current.current));
        setError(`文件第 ${jump.page} 页暂时无法加载，当前阅读位置已保留。`);
      }
    } finally {
      if (requestId.current === id) {
        navigationPending.current = false;
        setPending(false);
      }
    }
  }

  const note = supplementId ? getSupplement(supplementId) : undefined;
  const previewNote = preview ? getSupplement(preview.id) : undefined;
  const highlightedIds = groupPreview
    ? groupPreview.map((id) => getSupplement(id)!.locationId)
    : previewNote ? [previewNote.locationId]
    : selectedLocation ? [selectedLocation]
    : choiceIds && !supplementId ? choiceIds.map((id) => getSupplement(id)!.locationId) : [];
  const highlightedLocations = [...new Set(highlightedIds)].flatMap((id) => {
    const location = getLocation(id);
    return [
      { ...location, highlightId: location.id },
      ...(location.additionalRegions ?? []).map((part, index) => ({ ...location, ...part, highlightId: `${location.id}-part-${index + 1}` })),
    ];
  });
  const previous = history.at(-1);

  function closePageInput() {
    setEditingPage(false);
    setPageError("");
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.page-index')?.focus());
  }

  const pageControls = <div className="page-controls">
    <button className="icon-button" aria-label="上一页" disabled={currentPage === 1 || pending} onClick={() => { void navigate({ page: currentPage - 1 }); }}><Chevron direction="left" /></button>
    {editingPage ? <form id="page-jump" className="page-jump" aria-label="跳转页面" onBlur={() => {
      setEditingPage(false); setPageError("");
    }} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePageInput(); }
    }} onSubmit={(event) => {
      event.preventDefault();
      const result = resolvePageInput(pageInput);
      if (result.error !== undefined) { setPageError(result.error); return; }
      setEditingPage(false); setPageError("");
      void navigate({ page: result.page });
    }}>
      <input id="page-input" aria-label="页码" aria-invalid={!!pageError}
        aria-describedby={pageError ? "page-input-error" : undefined} placeholder={`1–${pageCount}`}
        autoFocus inputMode="numeric" enterKeyHint="go" value={pageInput} onChange={(event) => { setPageInput(event.target.value); setPageError(""); }}
        onFocus={(event) => event.currentTarget.select()} />
      <span>/{pageCount}</span>
      {pageError && <p id="page-input-error" className="page-input-error" role="alert">{pageError}</p>}
    </form> : <button className="page-index" type="button" aria-label={`第 ${currentPage} 页，共 ${pageCount} 页，点击输入页码`}
      title="输入页码，按 Enter 跳转" onClick={() => {
        setPageInput(String(currentPage)); setPageError(""); setEditingPage(true);
      }}>
      <span>{currentPage}/{pageCount}</span>
    </button>}
    <button className="icon-button" aria-label="下一页" disabled={currentPage === pageCount || pending} onClick={() => { void navigate({ page: currentPage + 1 }); }}><Chevron direction="right" /></button>
  </div>;

  return <div className="reader-app" onSubmitCapture={(event) => {
    if ((event.target as HTMLElement).matches('.page-jump') && document.querySelector('[data-dirty="true"]') && !window.confirm('有尚未保存的内容，放弃修改？')) {
      event.preventDefault(); event.stopPropagation();
    }
  }} onClickCapture={(event) => {
    const target = event.target as HTMLElement;
    if (target.closest('.split-resize, .panel-resize')) {
      cancelJump(); keepPreview(); clearPreview(); return;
    }
    if (target.closest('.markdown-editor, .create-linked-node, .personal-title, .personal-metadata, .method-toggle, .locate-button, .account-control, .legacy-copies, .supplement-graph, .graph-related, .node-link, .backlinks, #open-supplement-graph')) return;
    if (document.querySelector('[data-dirty="true"]') && target.closest('button, summary, input') && !window.confirm('有尚未保存的内容，放弃修改？')) {
      event.preventDefault(); event.stopPropagation();
    }
  }} onKeyDown={(event) => {
    if (event.key !== "Escape") return;
    const filters = event.currentTarget.querySelector<HTMLDetailsElement>('.supplement-filters[open]');
    if (filters) {
      filters.open = false;
      filters.querySelector('summary')?.focus();
      return;
    }
    if (selectionPage) { setSelectionPage(null); return; }
    if (personalItem) return;
    if (personalLibraryOpen) { event.preventDefault(); closePersonalLibrary(); return; }
    if (event.currentTarget.querySelector('.markdown-editor[data-dirty="true"]')) return;
    if (preview || groupPreview) {
      const id = preview?.id ?? groupPreview![0]!;
      clearPreview();
      focusMarker(id);
    } else if (supplementId || choiceIds) closeSupplement();
    else if (navigationOpen) {
      setNavigationOpen(false);
      toggleButton.current?.focus();
    }
  }}>
    <header className="toolbar reader-toolbar">
      <div className="book-heading">
        <h1>{bookTitle}</h1>
      </div>
      <div className="toolbar-actions">
        <div className="reader-toolbar-group reader-tools-browse" role="group" aria-label="查阅内容">
        <ContentSearch nodes={content.nodes} chapters={chapters} sections={sections} selectedKey={selectedGraphKey}
          onSelect={(key) => {
            if (!selectGraphNode(key)) return false;
            if (!graphOpen && views.bookVisible) locateGraphNode(key);
            if (graphOpen) setSearchTarget({ key });
            return true;
          }} />
        <button id="open-supplement-graph" className="icon-button" aria-label="节点图" title="节点图" disabled={!content.published} aria-expanded={graphOpen}
          aria-controls="supplement-graph" onClick={graphOpen ? closeGraph : openGraph}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 7 10 2M7 7l3 11m7-9-7 9" stroke="currentColor" strokeWidth="1.5" /><circle cx="7" cy="7" r="3" fill="var(--surface)" stroke="currentColor" strokeWidth="1.5" /><circle cx="17" cy="9" r="2.5" fill="var(--surface)" stroke="currentColor" strokeWidth="1.5" /><circle cx="10" cy="18" r="2.5" fill="var(--surface)" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
        </div>
        <div className="reader-toolbar-group reader-tools-supplement" role="group" aria-label="补充工具">
        <details className="supplement-filters" onPointerLeave={(event) => {
          if (event.pointerType !== 'mouse') return;
          const filters = event.currentTarget;
          if (filters.contains(document.activeElement)) filters.querySelector('summary')?.focus();
          filters.open = false;
        }}>
          <summary aria-label="显示补充类型" title="显示补充类型">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 7h16M4 17h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="9" cy="7" r="2.5" fill="var(--surface)" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="15" cy="17" r="2.5" fill="var(--surface)" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </summary>
          <div className="filter-options">
            {(Object.entries(supplementTypes) as [SupplementType, string][]).map(([type, label]) => <label key={type} data-supplement-type={type}>
              <TypeMarker type={type} /><span>{label}</span>
              <input className="sr-only" type="checkbox" checked={!hiddenTypes.includes(type)} onChange={() => {
                setHiddenTypes(hiddenTypes.includes(type) ? hiddenTypes.filter((value) => value !== type) : [...hiddenTypes, type]);
                clearPreview(); closeSupplement(); setPersonalItem(null);
              }} />
              <svg className="filter-check" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </label>)}
            {hiddenIds.length > 0 && <button className="text-button" onClick={() => setHiddenIds([])}>恢复隐藏的 {hiddenIds.length} 条补充</button>}
          </div>
        </details>
        <button id="add-personal-supplement" className="icon-button" aria-label="添加补充" title="添加补充" disabled={!ownsPersonal || content.loading} onClick={() => {
          views.show('book', true); closeSupplement(false); setPersonalItem(null); clearPreview(); setSelectionPage(currentPage);
        }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button>
        </div>
        <div className="reader-toolbar-group reader-tools-library" role="group" aria-label="书架与账号">
        <button type="button" className="icon-button return-to-shelf" aria-label="返回书架" title="返回书架" onClick={() => {
          onReturnToShelf(flushReadingPosition.current());
        }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h4v14H4zM10 5h4v14h-4zM16 6l3-1 3 13-3 1zM3 21h20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
        <AccountControl user={content.user} onSignIn={signIn} onPasswordSignIn={import.meta.env.DEV ? signInWithPassword : undefined} onSignOut={async () => {
          if (document.querySelector('[data-dirty="true"]') && !window.confirm('有尚未保存的内容，放弃修改并退出登录？')) throw new Error('已保留草稿，尚未退出登录。');
          closeSupplement(); setPersonalItem(null); setSelectionPage(null);
          await signOut();
        }} />
        </div>
      </div>
    </header>
    {selectionPage !== null && <div className="selection-help" role="status">在第 {selectionPage} 页拖动框选段落；键盘可用方向键调整，Enter 确认。<button className="text-button" onClick={() => setSelectionPage(null)}>取消</button></div>}
    {content.loading && <LoadingToast />}
    {(content.error || content.notice) && <div className={content.error ? 'storage-error' : 'content-status'} role={content.error ? 'alert' : 'status'}>
      <span>{content.error || content.notice}</span>{' '}
      <button className="text-button" onClick={() => {
        closeSupplement(); setPersonalItem(null); setSelectionPage(null);
        void content.refresh();
      }}>重新读取</button>
    </div>}
    {ownsPersonal && <LegacyCopies copies={content.personal!.copies} current={personal} titleForNote={(id) => getSupplement(id)?.title ?? id} />}
    {(navigationNotice || readingError) && <p className="storage-error" role="status">{[navigationNotice, readingError].filter(Boolean).join(' ')}</p>}
    <main ref={layoutRef} className={`reading-layout${navigationOpen && views.bookVisible ? " book-navigation-open" : ""}${panelBelow ? " panel-bottom" : ""}${graphOpen ? " graph-open" : ""}${views.split ? " views-split" : ""}${!views.bookVisible ? " book-hidden" : ""}${note || choiceIds || personalItem || personalLibraryOpen ? " supplement-open" : ""}`}>
      <div className="book-toolbar" hidden={!views.bookVisible} aria-label="教材工具栏">
      <button ref={toggleButton} id="book-navigation-toggle" className="icon-button navigation-toggle book-navigation-toggle"
        hidden={!views.bookVisible} aria-label={navigationOpen ? "收起教材目录" : "展开教材目录"}
        title="教材目录" aria-expanded={navigationOpen} aria-controls="page-sidebar" onClick={() => {
          clearPreview(); setNavigationOpen(!navigationOpen);
        }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><circle cx="4" cy="6" r="1" fill="currentColor" /><circle cx="4" cy="12" r="1" fill="currentColor" /><circle cx="4" cy="18" r="1" fill="currentColor" /></svg>
      </button>
      {pageControls}
      </div>
      <nav id="page-sidebar" className="page-sidebar book-navigation" hidden={!navigationOpen || !views.bookVisible} aria-label="教材目录"
        onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setNavigationOpen(false); toggleButton.current?.focus(); } }}>
        <div className="book-navigation-modes" role="group" aria-label="教材导航方式">
          <button type="button" aria-label="目录" title="目录" aria-pressed={navigationMode === 'contents'} onClick={() => setNavigationMode('contents')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><path d="M4 6h.01M4 12h.01M4 18h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
          </button>
          <button type="button" aria-label="页面" title="页面" aria-pressed={navigationMode === 'pages'} onClick={() => setNavigationMode('pages')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="3" width="6" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" /><rect x="14" y="3" width="6" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" /><rect x="4" y="15" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" /><rect x="14" y="15" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" /></svg>
          </button>
        </div>
        <div className="book-navigation-position" hidden={navigationMode !== 'pages'}>
          <span>文件第 {currentPage} 页</span>
          <span>{getPage(currentPage).printedPage === null ? '无印刷页码' : pageLabel(getPage(currentPage))}</span>
        </div>
        <div className="book-contents" hidden={navigationMode !== 'contents'}>
          {chapters.map((chapter) => <details key={chapter.id} data-current={currentPage >= chapter.start && currentPage <= chapter.end ? 'true' : undefined}>
            <summary>{chapter.title}</summary>
            <button type="button" onClick={() => { void navigate({ page: chapter.start }); }}>章首页</button>
            {sections.filter((section) => section.chapterId === chapter.id).map((section) =>
              <button type="button" key={section.id} aria-current={currentPage >= section.start && currentPage <= section.end ? 'location' : undefined}
                onClick={() => { void navigate({ page: section.start }); }}>{section.title}</button>)}
          </details>)}
        </div>
        <div className="page-thumbnails" ref={thumbnailList} hidden={navigationMode !== 'pages'}>
          {pages.map((page) => <button id={`thumbnail-${page.page}`} key={page.page} className="page-thumbnail" title={page.alt}
            tabIndex={page.page === currentPage ? 0 : -1} aria-label={`跳转到文件第 ${page.page} 页，${page.printedPage === null ? "无印刷页码" : pageLabel(page)}`} aria-current={page.page === currentPage ? "page" : undefined}
            onKeyDown={(event) => {
              const number = event.key === "ArrowDown" ? page.page + 1 : event.key === "ArrowUp" ? page.page - 1 : event.key === "Home" ? 1 : event.key === "End" ? pageCount : null;
              if (number !== null) { event.preventDefault(); document.getElementById(`thumbnail-${Math.max(1, Math.min(pageCount, number))}`)?.focus(); }
            }} onClick={() => { void navigate({ page: page.page }); }}>
            <img src={page.thumbnail} alt="" width="80" height="112" loading="lazy" />
          </button>)}
        </div>
      </nav>
      <div id="textbook-view" className="paper-scroller" ref={scroller} tabIndex={0} aria-label="教材连续阅读" inert={!views.bookVisible} aria-hidden={!views.bookVisible}
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (!target.matches('.page-image') && target !== event.currentTarget) return;
          if (navigationOpen) { setNavigationOpen(false); return; }
          const bottomPanel = panelBelow && (note || choiceIds || personalItem || personalLibraryOpen);
          if (!bottomPanel && !preview?.anchor.docked) return;
          if (document.querySelector('[data-dirty="true"]') && !window.confirm('有尚未保存的内容，放弃修改？')) return;
          keepPreview(); clearPreview();
          if (bottomPanel) { closeSupplement(); setPersonalItem(null); }
        }}
        onWheel={cancelJump} onTouchStart={cancelJump} onKeyDown={(event) => {
          if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) cancelJump();
        }}>
        <div className="paper-list" ref={pageList}>
          {pages.map((page) => <section id={`page-${page.page}`} key={page.page} className="paper" tabIndex={-1}
            aria-label={`教材文件第 ${page.page} 页，${page.printedPage === null ? "无印刷页码" : pageLabel(page)}`} style={{ aspectRatio: `${page.width} / ${page.height}` }}>
            <PageImage page={page} />
            {highlightedLocations.filter((location) => location.page === page.page).map((highlighted) => {
              const highlightedNote = supplementsForPage(getLocation(highlighted.id).page).find((item) => item.locationId === highlighted.id);
              return <div key={highlighted.highlightId} id={`location-${highlighted.highlightId}`} className={`location-highlight${previewNote || groupPreview ? " preview-highlight" : ""}`} tabIndex={-1}
                data-supplement-type={highlightedNote ? supplementType(highlightedNote) : 'review'}
                aria-label={`教材位置：${highlighted.anchorLabel}`} style={{ left: `${highlighted.region.x * 100}%`, top: `${highlighted.region.y * 100}%`,
                  width: `${highlighted.region.width * 100}%`, height: `${highlighted.region.height * 100}%` }} />;
            })}
            {groupMarkers(supplementsForPage(page.page).filter((item) => !hiddenIds.includes(item.id) && !hiddenTypes.includes(supplementType(item))).map((item) => {
              const { marker } = getLocation(item.locationId);
              return { id: item.id, x: marker.x * paperWidth, y: marker.y * paperWidth * page.height / page.width };
            }), markerSize).map((group) => {
              const item = getSupplement(group[0]!.id)!;
              const location = getLocation(item.locationId);
              const ids = group.map(({ id }) => id);
              const grouped = group.length > 1;
              const types = new Set(group.map(({ id }) => supplementType(getSupplement(id)!)));
              return <button key={item.id} id={`supplement-${item.id}`} className="supplement-marker" data-supplement-ids={ids.join(' ')} data-supplement-type={types.size === 1 ? supplementType(item) : 'group'}
                style={{ left: `${location.marker.x * 100}%`, top: `${location.marker.y * 100}%` }}
                aria-label={grouped ? `选择此处的${group.length}条解读` : `${supplementTypes[supplementType(item)]}：${item.title}`}
                aria-expanded={ids.includes(supplementId ?? '') || !!choiceIds?.some((id) => ids.includes(id)) || preview?.id === item.id}
                aria-controls={grouped || ids.includes(supplementId ?? '') ? "supplement-panel" : preview?.id === item.id ? "supplement-preview" : undefined}
                aria-describedby={preview?.id === item.id ? "supplement-preview" : undefined}
                onPointerEnter={(event) => { if (event.pointerType !== "touch") { if (grouped) showGroupPreview(ids); else showPreview(item.id, event.currentTarget); } }}
                onPointerLeave={leavePreview} onFocus={(event) => { if (!suppressPreviewFocus.current) { if (grouped) showGroupPreview(ids); else showPreview(item.id, event.currentTarget); } }}
                onBlur={(event) => { if (!(event.relatedTarget instanceof Node) || !document.getElementById("supplement-preview")?.contains(event.relatedTarget)) leavePreview(); }}
                onClick={() => grouped ? openChoices(ids) : openSupplement(item.id)}><TypeMarker type={grouped ? "group" : supplementType(item)} />
                {grouped && <span className="marker-count" aria-hidden="true">{group.length}</span>}
              </button>;
            })}
            {!hiddenTypes.includes('personal') && personal.supplements.filter((item) => item.page === page.page && item.region !== null && !hiddenIds.includes(item.id)).map((item) => <button key={item.id} className="supplement-marker personal-marker" data-supplement-type="personal" aria-label={`我的补充：${item.title}`}
              style={{ left: `${Math.min(.97, item.region!.x + item.region!.width) * 100}%`, top: `${item.region!.y * 100}%` }}
              onClick={() => openPersonal(item)}><TypeMarker type="personal" /></button>)}
            {personalItem?.region && personalItem.page === page.page && <div className="location-highlight" data-supplement-type="personal" style={{ left: `${personalItem.region.x * 100}%`, top: `${personalItem.region.y * 100}%`, width: `${personalItem.region.width * 100}%`, height: `${personalItem.region.height * 100}%` }} />}
            {selectionPage === page.page && <RegionSelector onSelect={(region) => {
              setPersonalItem({ id: crypto.randomUUID(), title: '', markdown: '', page: page.page, region,
                chapterId: chapters.find(({ start, end }) => page.page >= start && page.page <= end)?.id ?? null,
                sectionId: sections.find(({ start, end }) => page.page >= start && page.page <= end)?.id ?? null });
              setSelectionPage(null);
            }} />}
          </section>)}
        </div>
      </div>
      {graphMounted && <SupplementGraph searchTarget={searchTarget} nodes={content.nodes} selectedKey={selectedGraphKey} visible={graphOpen}
        personalEdges={references.edges}
        chapters={chapters} sections={sections} onSelect={selectGraphNode} bookVisible={views.bookVisible} onToggleBook={() => {
          cancelJump(); keepPreview(); clearPreview();
          if (views.narrow) setNavigationOpen(false);
          if (views.bookVisible) views.close('book');
          else {
            views.show('book');
            locateGraphNode(selectedGraphKey, views.capturePanelScroll());
          }
        }} />}
      {graphMounted && <SplitResize />}
      {(personalItem || personalLibraryOpen || choiceIds || note) && <PanelResize bottom={panelBelow} />}
      {personalLibraryOpen && <PersonalLibrary nodes={content.nodes.filter((node) => node.source === 'personal')} chapters={chapters} sections={sections}
        onOpen={openPersonal} onCreate={() => {
          setPersonalLibraryOpen(false);
          setPersonalItem({ id: crypto.randomUUID(), title: '', markdown: '', page: null, region: null,
            chapterId: newChapterId === undefined ? chapters.find(({ start, end }) => currentPage >= start && currentPage <= end)?.id ?? null : newChapterId, sectionId: null });
        }} onClose={closePersonalLibrary} />}
      {personalItem && <PersonalPanel chapters={chapters} sections={sections} links={links} onBack={openPersonalLibrary} onLocate={locateSupplement} onEdit={cancelJump} key={personalItem.id} item={personalItem} isNew={!personal.supplements.some((item) => item.id === personalItem.id)}
        backlinks={backlinksFor(nodeKey({ bookId, source: 'personal', id: personalItem.id }))}
        onClose={() => {
          setPersonalItem(null); closePersonalLibrary();
          if (graphOpen) requestAnimationFrame(() => document.getElementById('graph-search-toggle')?.focus({ preventScroll: true }));
        }} onSave={async (item) => {
          await storePersonal((current) => ({ ...current, supplements: [...current.supplements.filter((value) => value.id !== item.id), item] }));
          setHiddenTypes((types) => types.filter((type) => type !== 'personal'));
          setPersonalItem((current) => current?.id === item.id ? item : current);
        }} onDelete={async () => {
          await storePersonal((current) => ({ ...current, supplements: current.supplements.filter((item) => item.id !== personalItem.id) }));
          // Reopening the same ID creates a new selection that this delete must preserve.
          if (personalItemRef.current === personalItem) {
            setPersonalItem(null);
            setPersonalLibraryOpen(true);
            requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.personal-search input')?.focus({ preventScroll: true }));
          }
        }} />}
      {!personalItem && !personalLibraryOpen && (choiceIds || note) && <SupplementPanel key={choiceIds?.join(" ") ?? note?.id} notes={choiceIds ? choiceIds.map((id) => getSupplement(id)!) : [note!]}
        methodOpenIds={methodOpenIds} onMethodToggle={(id) => setMethodOpenIds((open) => open.includes(id) ? open.filter((value) => value !== id) : [...open, id])}
        expandedId={supplementId} onSelect={selectAccordion} pending={pending} onClose={() => closeSupplement()} onLocate={locateSupplement} onRelated={relatedJump}
        renderRelated={views.open.graph ? (item) => <GraphRelated nodeKey={nodeKey({ bookId, source: 'default', id: item.id })}
          nodes={content.nodes} onSelect={selectGraphNode} onLocate={(locationId, focusId) => {
            if (allowGraphSelection()) relatedJump(locationId, focusId);
          }} /> : undefined}
        onHide={(id) => { setHiddenIds([...hiddenIds, id]); closeSupplement(); }}
        renderPersonal={(item) => <>{backlinksFor(nodeKey({ bookId, source: 'default', id: item.id }))}<section className="personal-note" aria-label="我的笔记">
          {content.personal && (content.draftOwner || ownsPersonal && !content.loading) ? <MarkdownEditor onEdit={cancelJump} key={`${content.personal.userId}:${item.id}`} note value={content.personal.data.notes[item.id] ?? ''}
            bindings={content.personal.data.noteBindings?.[item.id]} links={{ ...links, chapterId: content.nodes.find((node) => node.source === 'default' && node.id === item.id)?.chapterId ?? null }}
            label="笔记 Markdown" onSave={(value, bindings) => saveNote(item.id, value, bindings)} />
            : <p>{content.user ? '个人笔记尚未载入，请读取成功后再编辑。' : '登录后可保存个人笔记。'}</p>}
        </section></>}
        activeLocationId={selectedLocation}
        onBack={previous ? () => { void navigate({ page: previous.page, restore: previous }); } : undefined} />}
    {preview && previewNote && <SupplementPreview key={preview.id} note={previewNote} anchor={preview.anchor}
      onKeep={keepPreview} onLeave={leavePreview} />}
    </main>
    {(pending || error) && <div className="reading-message" role={error ? "alert" : "status"}>
      <span>{error ?? "正在打开教材…"}</span>
      {error && <button className={`text-button${retryJump.current.locate ? ' locate-button' : ''}`} onClick={() => { void navigate(retryJump.current); }}>重试</button>}
    </div>}
  </div>;
}
