import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../account/supabase.ts';
import { migratePersonal, onPersonalSaved, savePersonal, type PersonalSnapshot } from './cloud-personal.ts';
import { personalStorageKey, type PersonalData } from './personal.ts';
import { contentNodes, type PublishedContent } from '../textbook/content.ts';
import { readPublishedContent } from '../textbook/content-store.ts';

const emptyPersonal: PersonalData = { supplements: [], notes: {} };
const accountChanged = (owner: User | null) => `账号已切换。${owner ? `账号 ${owner.email || owner.id} 的` : '原'}草稿已保留，请复制草稿或明确放弃后重新读取个人内容。`;
const externalChanged = '个人内容已在其他页面更改。请保留草稿，再刷新个人内容。';
const legacyChanged = '检测到旧页面保存的内容。新内容未被覆盖，请查看旧版副本。';
const message = (cause: unknown) => cause instanceof Error ? cause.message : '内容暂时无法读取，请重试。';
const hasDraft = () => !!document.querySelector('[data-dirty="true"]');
const copyNotice = (value: PersonalSnapshot) => value.notice ?? (value.copies.some((copy) => copy.has_conflict) ? legacyChanged : '');

export function useBookContent() {
  const [user, setUser] = useState<User | null>(null);
  const [published, setPublished] = useState<PublishedContent | null>(null);
  const [personal, setPersonal] = useState<PersonalSnapshot | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [publishedLoading, setPublishedLoading] = useState(true);
  const [personalLoading, setPersonalLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [publishedError, setPublishedError] = useState('');
  const [personalError, setPersonalError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const userRef = useRef<User | null>(null);
  const personalRef = useRef<PersonalSnapshot | null>(null);
  const generation = useRef(0);
  const publishedRequest = useRef(0);
  const personalRequest = useRef(0);
  const authEvent = useRef(0);
  const blockedForDraft = useRef(false);
  const draftOwner = useRef<User | null>(null);
  const loadingPersonal = useRef(false);
  const writes = useRef(Promise.resolve());
  const captureQueued = useRef(false);

  const current = useCallback((ownerId: string, version: number) =>
    mounted.current && generation.current === version && userRef.current?.id === ownerId, []);

  const loadPublished = useCallback(async () => {
    const request = ++publishedRequest.current;
    setPublishedLoading(true);
    try {
      const value = await readPublishedContent();
      if (mounted.current && publishedRequest.current === request) {
        setPublished(value);
        setPublishedError('');
      }
    } catch (cause) {
      if (mounted.current && publishedRequest.current === request) setPublishedError(message(cause));
    } finally {
      if (mounted.current && publishedRequest.current === request) setPublishedLoading(false);
    }
  }, []);

  const loadPersonal = useCallback(async (ownerId: string, version: number) => {
    const request = ++personalRequest.current;
    loadingPersonal.current = true;
    setPersonalLoading(true);
    try {
      await writes.current;
      if (!current(ownerId, version)) return;
      const value = await migratePersonal(ownerId);
      if (!current(ownerId, version) || personalRequest.current !== request) return;
      personalRef.current = value;
      setPersonal(value);
      setPersonalError('');
      setNotice(copyNotice(value));
    } catch (cause) {
      if (current(ownerId, version) && personalRequest.current === request) setPersonalError(message(cause));
    } finally {
      if (current(ownerId, version) && personalRequest.current === request) {
        loadingPersonal.current = false;
        setPersonalLoading(false);
      }
    }
  }, [current]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      publishedRequest.current += 1;
      personalRequest.current += 1;
    };
  }, []);

  useEffect(() => { void loadPublished(); }, [loadPublished]);

  useEffect(() => {
    function acceptUser(next: User | null, clearError = true) {
      if (!mounted.current) return;
      if (userRef.current?.id !== next?.id) {
        generation.current += 1;
        personalRequest.current += 1;
        loadingPersonal.current = false;
        setPersonalLoading(false);
        blockedForDraft.current = hasDraft();
        if (blockedForDraft.current) {
          draftOwner.current ??= userRef.current;
          setPersonalError(accountChanged(draftOwner.current));
        }
        else {
          draftOwner.current = null;
          personalRef.current = null;
          setPersonal(null);
          setPersonalError('');
          setNotice('');
        }
      }
      userRef.current = next;
      setUser(next);
      setAuthReady(true);
      if (clearError) setAuthError('');
    }

    const bootstrap = authEvent.current;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        if (authEvent.current === bootstrap) acceptUser(session?.user ?? null, false);
        return;
      }
      authEvent.current += 1;
      acceptUser(session?.user ?? null);
    });
    void (async () => {
      // getSession() reads stored state but does not return URL initialization errors.
      const initialized = await supabase.auth.initialize();
      if (!mounted.current || authEvent.current !== bootstrap) return;
      const { data, error } = await supabase.auth.getSession();
      if (!mounted.current || authEvent.current !== bootstrap) return;
      acceptUser(data.session?.user ?? null, false);
      setAuthError(initialized.error
        ? '登录链接无法使用，请重新发送登录邮件。'
        : error ? message(error) : '');
    })().catch((cause: unknown) => {
      if (mounted.current && authEvent.current === bootstrap) {
        setAuthError(message(cause));
        setAuthReady(true);
      }
    });
    return () => { authEvent.current += 1; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (authReady && user?.id && !blockedForDraft.current) void loadPersonal(user.id, generation.current);
  }, [authReady, user?.id, loadPersonal]);

  useEffect(() => {
    function captureLegacy() {
      const ownerId = userRef.current?.id;
      const version = generation.current;
      if (!ownerId || blockedForDraft.current || loadingPersonal.current || captureQueued.current || !personalRef.current) return;
      captureQueued.current = true;
      const write = writes.current.then(async () => {
        if (!current(ownerId, version) || blockedForDraft.current) return;
        const latest = await migratePersonal(ownerId);
        if (!current(ownerId, version) || blockedForDraft.current) return;
        const previous = personalRef.current;
        if (!previous || previous.userId !== ownerId) return;
        // Capturing a late legacy write must not adopt a newer editing baseline.
        // That would let the next autosave overwrite another tab's content.
        const value = { ...previous, copies: latest.copies, notice: latest.notice };
        personalRef.current = value;
        setPersonal(value);
        if (latest.revision !== previous.revision) setNotice(externalChanged);
        else if (copyNotice(latest)) setNotice(copyNotice(latest));
      });
      writes.current = write.catch((cause: unknown) => {
        if (current(ownerId, version)) setPersonalError(message(cause));
      }).finally(() => { captureQueued.current = false; });
    }
    function storage(event: StorageEvent) {
      if (event.key === personalStorageKey || event.key === null) captureLegacy();
    }
    function visible() { if (document.visibilityState === 'visible') captureLegacy(); }
    window.addEventListener('storage', storage);
    window.addEventListener('focus', captureLegacy);
    document.addEventListener('visibilitychange', visible);
    const stop = onPersonalSaved(({ external }) => {
      if (external && userRef.current) setNotice(externalChanged);
    });
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener('focus', captureLegacy);
      document.removeEventListener('visibilitychange', visible);
      stop();
    };
  }, [current]);

  // A callback kept by an old editor must never adopt a later account/session.
  const ownerId = user?.id;
  const version = generation.current;
  const updatePersonal = useCallback((update: (data: PersonalData) => PersonalData): Promise<void> => {
    const write = writes.current.then(async () => {
      const previous = personalRef.current;
      if (blockedForDraft.current) throw new Error(accountChanged(draftOwner.current));
      if (!ownerId) throw new Error('请先登录，再保存个人内容。草稿已保留。');
      if (!current(ownerId, version)) throw new Error(accountChanged(draftOwner.current));
      if (!previous) throw new Error('个人内容尚未载入。草稿已保留，请读取成功后重试。');
      if (previous.userId !== ownerId) throw new Error(accountChanged(draftOwner.current));
      if (loadingPersonal.current) throw new Error('正在读取个人内容。草稿已保留，请稍后重试。');
      const value = await savePersonal(update(structuredClone(previous.data)), previous);
      if (!current(ownerId, version)) throw new Error(accountChanged(draftOwner.current));
      blockedForDraft.current = false;
      personalRef.current = value;
      setPersonal(value);
      setPersonalError('');
    }).catch((cause: unknown) => {
      if (ownerId && current(ownerId, version)) setPersonalError(message(cause));
      throw cause;
    });
    writes.current = write.catch(() => {});
    return write;
  }, [current, ownerId, version]);

  // The caller must protect/close any dirty editor before an explicit refresh.
  const refresh = useCallback(async () => {
    generation.current += 1;
    personalRequest.current += 1;
    blockedForDraft.current = false;
    draftOwner.current = null;
    const ownerId = userRef.current?.id;
    if (!ownerId) {
      personalRef.current = null;
      setPersonal(null);
      setPersonalError('');
      setNotice('');
      loadingPersonal.current = false;
      setPersonalLoading(false);
    }
    await Promise.all([loadPublished(), ownerId ? loadPersonal(ownerId, generation.current) : Promise.resolve()]);
  }, [loadPersonal, loadPublished]);

  const nodes = useMemo(() => published ? contentNodes(published,
    personal?.userId === user?.id ? personal?.data ?? emptyPersonal : emptyPersonal) : [], [published, personal, user?.id]);

  return { user, published, personal, nodes, loading: !authReady || publishedLoading || personalLoading,
    error: authError || personalError || publishedError, notice, refresh, updatePersonal,
    draftOwner: blockedForDraft.current ? draftOwner.current : null };
}

export type BookContent = ReturnType<typeof useBookContent>;
