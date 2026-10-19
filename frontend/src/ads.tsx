import { useEffect, useState, type ReactNode } from "react";

const VK_ADS_SRC = "https://ad.mail.ru/static/ads-async.js";
const WIDE_SCREEN = "(min-width: 1480px)";
const LEFT_SLOT = "2091438";
const RIGHT_SLOT = "2091440";

type VkWindow = Window & {
  MRGtag?: Array<Record<string, never>>;
};

let adsScriptStarted = false;

function ensureVkAds() {
  if (adsScriptStarted || document.querySelector(`script[src="${VK_ADS_SRC}"]`)) {
    adsScriptStarted = true;
    return;
  }
  adsScriptStarted = true;
  const script = document.createElement("script");
  script.src = VK_ADS_SRC;
  script.async = true;
  document.head.appendChild(script);
}

export function VkBanner(props: { slot: string }) {
  useEffect(() => {
    ensureVkAds();
    const win = window as VkWindow;
    win.MRGtag = win.MRGtag ?? [];
    win.MRGtag.push({});
  }, [props.slot]);

  return (
    <ins
      className="mrg-tag"
      style={{ display: "inline-block", width: 300, height: 600 }}
      data-ad-client={`ad-${props.slot}`}
      data-ad-slot={props.slot}
    />
  );
}

function useWideScreen() {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_SCREEN).matches);

  useEffect(() => {
    const query = window.matchMedia(WIDE_SCREEN);
    const apply = () => setWide(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  return wide;
}

export function PageFrame(props: { children: ReactNode }) {
  const wide = useWideScreen();

  return (
    <main className="flex min-h-screen items-start justify-center gap-6 bg-zinc-900 bg-[linear-gradient(rgba(0,0,0,0.35)_2px,transparent_2px),linear-gradient(90deg,rgba(0,0,0,0.35)_2px,transparent_2px)] bg-size-[32px_32px] px-4 py-12 text-zinc-200">
      {wide ? <AdColumn slot={LEFT_SLOT} /> : null}
      <div className="flex w-full min-w-0 max-w-5xl flex-col items-center">
        {props.children}
        {wide ? null : (
          <div className="mt-8 flex flex-wrap justify-center gap-6">
            <VkBanner slot={LEFT_SLOT} />
            <VkBanner slot={RIGHT_SLOT} />
          </div>
        )}
      </div>
      {wide ? <AdColumn slot={RIGHT_SLOT} /> : null}
    </main>
  );
}

function AdColumn(props: { slot: string }) {
  return (
    <aside className="sticky top-6 w-[300px] shrink-0" aria-label="Реклама">
      <VkBanner slot={props.slot} />
    </aside>
  );
}
