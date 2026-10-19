import { useEffect, type ReactNode } from "react";
import { PageFrame } from "./ads";

export type PlanId = "premium" | "ultra" | "max";

export const SELLER = {
  status: "самозанятый",
  name: "Мокрушин Иван Витальевич",
  inn: "660609514261",
  phone: "8 912 226 27 14",
  phoneHref: "tel:+79122262714",
  email: "mokrushinivan21@gmail.com",
};

export const PLANS: Array<{
  tier: PlanId;
  title: string;
  price: string;
  quota: string;
  summary: string;
  description: string;
}> = [
  {
    tier: "premium",
    title: "Premium",
    price: "200 ₽",
    quota: "15 генераций в неделю · 30 дней",
    summary: "Тариф действует 30 дней с оплаты. Внутри этого срока каждые 7 дней снова доступно 15 генераций. Потом план сам становится бесплатным.",
    description:
      "Цифровая услуга сервиса AI Minecraft Modpack Generator. ИИ подбирает моды под выбранную версию Minecraft и загрузчик, после правки списка сервис собирает ZIP для Prism Launcher или обычную папку с модами и сам добавляет обязательные библиотеки.",
  },
  {
    tier: "ultra",
    title: "Ultra",
    price: "400 ₽",
    quota: "30 генераций в неделю · 30 дней",
    summary: "Тариф действует 30 дней с оплаты. Внутри этого срока каждые 7 дней снова доступно 30 генераций. Потом план сам становится бесплатным.",
    description:
      "Тот же сервис сборки модпаков, что и Premium, с увеличенным недельным лимитом. Подходит, если нужно чаще пересобирать списки модов и скачивать новые архивы.",
  },
  {
    tier: "max",
    title: "Максимум",
    price: "1000 ₽",
    quota: "Безлимит генераций · 30 дней",
    summary: "Тариф действует 30 дней с оплаты. Внутри этого срока число генераций не ограничено. На 31-й день план сам становится бесплатным.",
    description:
      "Полный доступ к генерации и сборке модпаков без недельного счётчика, пока не закончились 30 дней. Повторного списания нет: чтобы продлить, нужно оплатить тариф ещё раз.",
  },
];

const linkClass = "text-[#D6B56A] underline-offset-4 hover:underline";

export function SiteFooter() {
  return (
    <footer className="mt-10 w-full max-w-5xl border-4 border-t-zinc-500 border-r-zinc-900 border-b-zinc-950 border-l-zinc-600 bg-zinc-800 px-4 py-5 text-sm text-zinc-300">
      <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2" aria-label="Документы сайта">
        <a className={linkClass} href="/oferta">Публичная оферта</a>
        <a className={linkClass} href="/privacy">Политика конфиденциальности</a>
        <a className={linkClass} href="/contacts">Контакты</a>
        <a className={linkClass} href="/delivery">Доставка и получение</a>
      </nav>
      <p className="mt-4 text-center text-xs leading-5 text-zinc-400">
        {SELLER.status} {SELLER.name}, ИНН {SELLER.inn}.{" "}
        <a className={linkClass} href={SELLER.phoneHref}>{SELLER.phone}</a>
        {", "}
        <a className={linkClass} href={`mailto:${SELLER.email}`}>{SELLER.email}</a>
      </p>
    </footer>
  );
}

export function PlanCatalog(props: {
  buyingTier: PlanId | null;
  error: string | null;
  onBuy: (tier: PlanId) => void;
}) {
  return (
    <section id="uslugi" className="mt-8 w-full max-w-5xl border-4 border-t-zinc-500 border-r-zinc-900 border-b-zinc-950 border-l-zinc-600 bg-zinc-800 p-6 sm:p-8">
      <h2 className="text-center font-pixel text-2xl text-[#D6B56A]">Услуги и цены</h2>
      <p className="mx-auto mt-3 max-w-3xl text-center text-sm leading-6 text-zinc-300">
        Продаётся доступ к онлайн-сервису генерации сборок Minecraft на 30 дней. Это цифровая услуга:
        после оплаты тариф открывается в личном кабинете в течение 5 минут, а через 30 дней сам
        становится бесплатным. Курьерская доставка не используется.
      </p>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {PLANS.map((plan) => (
          <article
            key={plan.tier}
            className="flex flex-col border-4 border-t-zinc-600 border-r-zinc-950 border-b-black border-l-zinc-700 bg-black p-4"
          >
            <PlanIcon tier={plan.tier} />
            <h3 className="mt-4 font-pixel text-lg text-[#8FB58A]">{plan.title}</h3>
            <p className="mt-3 font-pixel text-3xl text-[#D6B56A]">{plan.price}</p>
            <p className="mt-2 text-sm text-zinc-100">{plan.quota}</p>
            <p className="mt-3 text-sm leading-6 text-zinc-300">{plan.description}</p>
            <p className="mt-3 flex-1 text-sm leading-6 text-zinc-400">{plan.summary}</p>
            <button
              className="mt-5 w-full border-4 border-t-zinc-400 border-r-zinc-600 border-b-zinc-700 border-l-zinc-500 bg-zinc-600 px-4 py-3 text-zinc-100 enabled:hover:border-green-400 enabled:hover:bg-zinc-500 enabled:hover:text-[#55FF55] disabled:cursor-wait disabled:bg-zinc-700 disabled:text-zinc-500"
              type="button"
              onClick={() => props.onBuy(plan.tier)}
              disabled={props.buyingTier !== null}
            >
              {props.buyingTier === plan.tier ? "Открываю оплату..." : "Купить"}
            </button>
          </article>
        ))}
      </div>
      {props.error ? (
        <p className="mt-5 text-center text-sm text-[#FF5555]">{props.error}</p>
      ) : null}
      <p className="mt-5 text-center text-sm text-zinc-400">
        Бесплатно доступно 3 генерации в неделю. Подробности получения услуги — на странице{" "}
        <a className={linkClass} href="/delivery">«Доставка и получение»</a>.
      </p>
    </section>
  );
}

function PlanIcon(props: { tier: PlanId }) {
  const color = props.tier === "max" ? "#D6B56A" : props.tier === "ultra" ? "#8FB58A" : "#9EC9E0";
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`Значок тарифа ${props.tier}`}>
      <rect x="4" y="4" width="56" height="56" fill="#18181b" stroke={color} strokeWidth="4" />
      {props.tier === "premium" ? (
        <path d="M16 44 V22 H32 L40 30 V44 Z M32 22 V30 H40" fill="none" stroke={color} strokeWidth="4" />
      ) : null}
      {props.tier === "ultra" ? (
        <path d="M32 14 L38 26 H52 L41 34 L45 48 L32 40 L19 48 L23 34 L12 26 H26 Z" fill={color} />
      ) : null}
      {props.tier === "max" ? (
        <path d="M18 40 L32 14 L46 40 H18 Z M22 40 H42 L32 52 Z" fill={color} />
      ) : null}
    </svg>
  );
}

type LegalKind = "offer" | "privacy" | "contacts" | "delivery";

const TITLES: Record<LegalKind, string> = {
  offer: "Публичная оферта",
  privacy: "Политика конфиденциальности",
  contacts: "Контакты",
  delivery: "Доставка и получение",
};

export function pageKind(pathname: string): LegalKind | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/oferta" || path === "/terms") {
    return "offer";
  }
  if (path === "/privacy") {
    return "privacy";
  }
  if (path === "/contacts") {
    return "contacts";
  }
  if (path === "/delivery") {
    return "delivery";
  }
  return null;
}

export function LegalScreen(props: { kind: LegalKind }) {
  useEffect(() => {
    document.title = `${TITLES[props.kind]} — AI Minecraft Modpack Generator`;
    window.scrollTo(0, 0);
  }, [props.kind]);

  return (
    <PageFrame>
      <article className="w-full max-w-3xl border-4 border-t-zinc-500 border-r-zinc-900 border-b-zinc-950 border-l-zinc-600 bg-zinc-800 p-6 sm:p-10">
        <a className={`${linkClass} text-sm`} href="/">На главную</a>
        <h1 className="mt-4 font-pixel text-2xl leading-relaxed text-[#D6B56A] sm:text-3xl">
          {TITLES[props.kind]}
        </h1>
        <div className="mt-6 space-y-8 text-sm leading-6 text-zinc-300">
          {props.kind === "offer" ? <OfferBody /> : null}
          {props.kind === "privacy" ? <PrivacyBody /> : null}
          {props.kind === "contacts" ? <ContactsBody /> : null}
          {props.kind === "delivery" ? <DeliveryBody /> : null}
        </div>
      </article>
      <SiteFooter />
    </PageFrame>
  );
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-pixel text-lg text-[#8FB58A]">{props.title}</h2>
      <div className="mt-3 space-y-3">{props.children}</div>
    </section>
  );
}

function OfferBody() {
  return (
    <>
      <p>
        Настоящий документ — публичная оферта самозанятого {SELLER.name}, ИНН {SELLER.inn},
        на оказание цифровой услуги через сайт сервиса «AI Minecraft Modpack Generator».
        Оплата любого тарифа на сайте означает полное принятие этих условий.
      </p>
      <Section title="1. Термины">
        <p>Исполнитель — {SELLER.status} {SELLER.name}, ИНН {SELLER.inn}.</p>
        <p>Заказчик — человек, который вошёл на сайт и оплатил тариф.</p>
        <p>
          Услуга — предоставление доступа к генерации списка модов Minecraft и сборке
          ZIP-архива для Prism Launcher или папки с jar-файлами модов в пределах оплаченного тарифа.
        </p>
        <p>Сайт — страницы этого сервиса, включая главную, каталог тарифов и личный кабинет.</p>
      </Section>
      <Section title="2. Предмет договора">
        <p>
          Исполнитель оказывает Заказчику цифровую услугу, а Заказчик оплачивает её
          по цене, указанной на сайте на момент оплаты. Услуга не является продажей игры
          Minecraft, модов или чужих авторских прав: архив собирается для личного запуска
          у Заказчика, файлы модов берутся с CurseForge.
        </p>
        <p>На сайте продаются три тарифа с фиксированной ценой:</p>
        <ul className="list-disc space-y-2 pl-5">
          {PLANS.map((plan) => (
            <li key={plan.tier}>
              {plan.title}: {plan.price}. {plan.quota}. {plan.summary} {plan.description}
            </li>
          ))}
        </ul>
        <p>Бесплатный режим — 3 генерации в неделю — офертой не оплачивается и доступен после входа.</p>
      </Section>
      <Section title="3. Порядок оказания услуги">
        <p>
          Услуга цифровая. Физическая доставка, трек-номер и передача товара курьером не применяются.
        </p>
        <p>
          После успешной оплаты ЮKassa тариф открывается в личном кабинете на сайте в течение
          5 минут. Кабинет привязан к электронной почте, с которой Заказчик вошёл на сайт.
          Отдельное письмо со ссылкой на активацию не требуется: Заказчик заходит на сайт
          под той же почтой и нажимает «Сгенерировать», затем скачивает ZIP в браузере.
        </p>
        <p>
          Оплаченный тариф действует 30 дней с момента успешной оплаты. Новая оплата начинает
          новый срок в 30 дней и заменяет предыдущий. Автоматического продления и повторного
          списания нет. Когда срок заканчивается, тариф в кабинете сам меняется на бесплатный:
          3 генерации в неделю.
        </p>
        <p>
          У Premium и Ultra внутри этих 30 дней недельный лимит обновляется каждые 7 суток:
          снова 15 или 30 генераций. У тарифа «Максимум» внутри этих 30 дней число генераций
          не ограничено.
        </p>
      </Section>
      <Section title="4. Цена и оплата">
        <p>
          Цена каждого тарифа указана на главной странице в разделе «Услуги и цены» и является
          окончательной. Валюта — российский рубль. Оплата проходит через ЮKassa банковской картой
          или другим способом, который показывает платёжная страница. Чек направляет платёжный сервис.
        </p>
        <p>Обязанность Заказчика по оплате считается исполненной в момент успешного статуса платежа.</p>
      </Section>
      <Section title="5. Условия возврата денежных средств">
        <p>
          Если в течение 5 минут после успешной оплаты тариф не появился в личном кабинете,
          Заказчик пишет на {SELLER.email}. Исполнитель возвращает всю сумму.
        </p>
        <p>
          Если оплаченные генерации ещё ни разу не запускались, Заказчик может запросить полный
          возврат в течение 7 календарных дней с момента оплаты.
        </p>
        <p>
          Если часть генераций тарифа Premium или Ultra уже использована, возвращается доля цены,
          пропорциональная неиспользованному остатку текущего недельного лимита. Для тарифа
          «Максимум» после первой успешной генерации услуга считается начатой: возврат делается,
          только если доступ так и не был предоставлен. Возврат относится к текущим оплаченным
          30 дням. Когда тариф уже сам стал бесплатным, отдельный возврат за этот срок не делается.
        </p>
        <p>
          В письме на возврат нужны почта аккаунта, дата и сумма платежа. Исполнитель отвечает
          в течение 10 рабочих дней и возвращает деньги тем же способом через ЮKassa.
        </p>
      </Section>
      <Section title="6. Обязанности сторон">
        <p>
          Исполнитель открывает оплаченный тариф и принимает обращения на {SELLER.email} и по
          телефону {SELLER.phone}. Заказчик указывает верную почту при входе и не передаёт доступ
          к аккаунту другим людям для обхода лимита.
        </p>
        <p>
          Сервис подбирает моды автоматически. Исполнитель не обещает, что каждая сборка запустится
          на любом компьютере без правки списка, и показывает предупреждение, если часть модов
          не нашлась под выбранную версию.
        </p>
      </Section>
      <Section title="7. Ответственность и персональные данные">
        <p>
          Исполнитель не отвечает за сбои Minecraft, лаунчера, CurseForge, банка и ЮKassa.
          Обработка почты, идентификатора аккаунта и факта оплаты описана в{" "}
          <a className={linkClass} href="/privacy">политике конфиденциальности</a>.
          Данные банковской карты на сайт не сохраняются: их принимает ЮKassa.
        </p>
      </Section>
      <Section title="8. Срок оферты">
        <p>
          Оферта действует бессрочно, пока текст опубликован на сайте. Исполнитель может изменить
          текст; для уже оплаченного тарифа действуют условия на момент оплаты. Новая редакция
          начинает действовать с момента публикации.
        </p>
      </Section>
      <Section title="9. Реквизиты исполнителя">
        <p>Самозанятый {SELLER.name}</p>
        <p>ИНН {SELLER.inn}</p>
        <p>Телефон: <a className={linkClass} href={SELLER.phoneHref}>{SELLER.phone}</a></p>
        <p>Почта: <a className={linkClass} href={`mailto:${SELLER.email}`}>{SELLER.email}</a></p>
      </Section>
    </>
  );
}

function PrivacyBody() {
  return (
    <>
      <p>
        Политика описывает, как {SELLER.status} {SELLER.name} (ИНН {SELLER.inn}) обрабатывает
        персональные данные посетителей сайта «AI Minecraft Modpack Generator».
      </p>
      <Section title="Какие данные обрабатываются">
        <p>Адрес электронной почты и идентификатор аккаунта — чтобы пускать в личный кабинет и привязывать тариф.</p>
        <p>Идентификатор Discord — только если Заказчик сам выбрал вход через Discord.</p>
        <p>Факт, сумма и тариф платежа — чтобы открыть оплаченный доступ. Номер карты сайт не получает и не хранит.</p>
        <p>Счётчик генераций, дата начала недели и дата окончания тарифа — чтобы соблюдать лимит и через 30 дней вернуть бесплатный план.</p>
      </Section>
      <Section title="Зачем и на каком основании">
        <p>
          Данные нужны, чтобы заключить и исполнить договор (оферту), открыть тариф, ответить на
          обращение и сделать возврат. Почта для входа обрабатывается, потому что без неё кабинет
          не создать.
        </p>
      </Section>
      <Section title="Кому передаются данные">
        <p>Вход и хранение профиля — Supabase. Приём платежа — ЮKassa. Подбор модов — сервис модели по описанию сборки, без номера карты и без платёжных реквизитов.</p>
        <p>Продажа базы адресов третьим лицам не производится.</p>
      </Section>
      <Section title="Срок и права">
        <p>
          Данные аккаунта хранятся, пока кабинет существует и пока их нужно хранить для спора по
          оплате. Запрос на доступ, исправление или удаление можно отправить на {SELLER.email}.
          Удаление аккаунта не отменяет уже оказанную и использованную услугу.
        </p>
      </Section>
      <Section title="Контакт оператора">
        <p>{SELLER.name}, ИНН {SELLER.inn}</p>
        <p><a className={linkClass} href={SELLER.phoneHref}>{SELLER.phone}</a></p>
        <p><a className={linkClass} href={`mailto:${SELLER.email}`}>{SELLER.email}</a></p>
      </Section>
    </>
  );
}

function ContactsBody() {
  return (
    <>
      <p>По вопросам оплаты, тарифа и возврата можно написать или позвонить исполнителю напрямую.</p>
      <Section title="Связь">
        <p>
          Телефон: <a className={linkClass} href={SELLER.phoneHref}>{SELLER.phone}</a>
        </p>
        <p>
          Электронная почта: <a className={linkClass} href={`mailto:${SELLER.email}`}>{SELLER.email}</a>
        </p>
        <p>Ответ на письмо — в рабочие дни, обычно в течение одного дня.</p>
      </Section>
      <Section title="Реквизиты самозанятого">
        <p>Статус: {SELLER.status}</p>
        <p>ФИО: {SELLER.name}</p>
        <p>ИНН: {SELLER.inn}</p>
      </Section>
    </>
  );
}

function DeliveryBody() {
  return (
    <>
      <p>
        Сервис продаёт цифровую услугу на 30 дней, а не физический товар. Курьер, почта России,
        пункты выдачи и самовывоз не используются. Регион получения — любой, где открывается сайт
        и платёжная страница ЮKassa. Когда 30 дней проходят, доступ сам возвращается к бесплатному
        плану: 3 генерации в неделю.
      </p>
      <Section title="Как заказчик получает услугу">
        <p>
          После успешной оплаты тариф активируется в личном кабинете в течение 5 минут.
          Кабинет — это вход на сайт по той же электронной почте, которую Заказчик указал при регистрации.
        </p>
        <p>
          Отдельная ссылка на скачивание тарифа на почту не отправляется: Заказчик обновляет страницу
          сайта, входит в аккаунт и сразу может нажать «Сгенерировать». Готовый ZIP-архив сборки
          скачивается браузером на компьютер Заказчика.
        </p>
        <p>
          Если через 5 минут тариф в кабинете не изменился, Заказчик пишет на {SELLER.email}
          с почтой аккаунта и временем оплаты. Если доступ так и не открыт, деньги возвращаются
          по правилам <a className={linkClass} href="/oferta">публичной оферты</a>.
        </p>
      </Section>
    </>
  );
}
