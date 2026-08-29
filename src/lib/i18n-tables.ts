/**
 * The translations themselves.
 *
 * # Why they are not in `i18n.ts`
 *
 * Because that file is the machinery — the lookup, the plural rule, the
 * direction switch — and this is data. Keeping them apart means a translator
 * adding a language touches one file with no logic in it, and a change to the
 * lookup cannot accidentally alter a string.
 *
 * # On plural forms
 *
 * The interpolator defers to `Intl.PluralRules`, so every CLDR category is
 * available and each language uses the ones it actually has. That is not
 * pedantry:
 *
 * - **German, Spanish, French, Portuguese** use `one` and `other`, like
 *   English. French differs in one real way — it treats 0 and 1 alike — and
 *   `Intl` knows that, so `0 piste` is produced without anything here saying so.
 * - **Japanese** has no grammatical number at all. One `other` branch is not a
 *   shortcut; a Japanese string with a singular form would be wrong.
 * - **Arabic** has six categories, and all six are genuinely different words.
 *   Writing only `one` and `other` would produce broken Arabic for the
 *   commonest counts — 2, 3 and 11 are each a different form.
 * - **Hebrew** distinguishes `one`, `two` and `other`.
 *
 * # What "complete" means
 *
 * Every key in `EN` has an entry. `missing()` in `i18n.ts` is what proves it,
 * and a test asserts it for every language marked complete — so a key added to
 * English later fails the suite rather than silently falling back.
 */

import type { EN, StringKey } from '@/lib/i18n';

type Table = Record<StringKey, string>;

/** Keeps a table honest: every key, no extras. */
type Complete<T extends Record<keyof typeof EN, string>> = T;

const de: Complete<Table> = {
  'nav.home': 'Start',
  'nav.search': 'Suche',
  'nav.library': 'Bibliothek',
  'nav.settings': 'Einstellungen',

  'player.play': 'Wiedergeben',
  'player.pause': 'Pause',
  'player.next': 'Weiter',
  'player.previous': 'Zurück',
  'player.shuffle': 'Zufallswiedergabe',
  'player.repeat': 'Wiederholen',
  'player.queue': 'Warteschlange',
  'player.live': 'Live',

  'library.tracks': '{count, plural, one {# Titel} other {# Titel}}',
  'library.albums': '{count, plural, one {# Album} other {# Alben}}',
  'library.empty': 'Hier ist noch nichts.',

  'action.like': 'Gefällt mir',
  'action.unlike': 'Aus „Gefällt mir“ entfernen',
  'action.download': 'Herunterladen',
  'action.addToPlaylist': 'Zur Playlist hinzufügen',
  'action.playNext': 'Als Nächstes spielen',
  'action.addToQueue': 'Zur Warteschlange hinzufügen',

  'time.justNow': 'Gerade eben',
  'time.minutesAgo':
    '{count, plural, one {vor # Minute} other {vor # Minuten}}',
  'time.hoursAgo': '{count, plural, one {vor # Stunde} other {vor # Stunden}}',
  'time.daysAgo': '{count, plural, one {vor # Tag} other {vor # Tagen}}',
};

const es: Complete<Table> = {
  'nav.home': 'Inicio',
  'nav.search': 'Buscar',
  'nav.library': 'Biblioteca',
  'nav.settings': 'Ajustes',

  'player.play': 'Reproducir',
  'player.pause': 'Pausar',
  'player.next': 'Siguiente',
  'player.previous': 'Anterior',
  'player.shuffle': 'Aleatorio',
  'player.repeat': 'Repetir',
  'player.queue': 'Cola',
  'player.live': 'En directo',

  'library.tracks': '{count, plural, one {# canción} other {# canciones}}',
  'library.albums': '{count, plural, one {# álbum} other {# álbumes}}',
  'library.empty': 'Aquí no hay nada todavía.',

  'action.like': 'Me gusta',
  'action.unlike': 'Quitar de Me gusta',
  'action.download': 'Descargar',
  'action.addToPlaylist': 'Añadir a la lista',
  'action.playNext': 'Reproducir a continuación',
  'action.addToQueue': 'Añadir a la cola',

  'time.justNow': 'Ahora mismo',
  'time.minutesAgo':
    '{count, plural, one {hace # minuto} other {hace # minutos}}',
  'time.hoursAgo': '{count, plural, one {hace # hora} other {hace # horas}}',
  'time.daysAgo': '{count, plural, one {hace # día} other {hace # días}}',
};

const fr: Complete<Table> = {
  'nav.home': 'Accueil',
  'nav.search': 'Recherche',
  'nav.library': 'Bibliothèque',
  'nav.settings': 'Réglages',

  'player.play': 'Lecture',
  'player.pause': 'Pause',
  'player.next': 'Suivant',
  'player.previous': 'Précédent',
  'player.shuffle': 'Aléatoire',
  'player.repeat': 'Répéter',
  'player.queue': 'File d’attente',
  'player.live': 'En direct',

  // French counts 0 as singular, which `Intl.PluralRules` already knows — so
  // "0 piste" comes out correctly without a branch for it here.
  'library.tracks': '{count, plural, one {# piste} other {# pistes}}',
  'library.albums': '{count, plural, one {# album} other {# albums}}',
  'library.empty': 'Rien ici pour l’instant.',

  'action.like': 'J’aime',
  'action.unlike': 'Retirer des titres aimés',
  'action.download': 'Télécharger',
  'action.addToPlaylist': 'Ajouter à la playlist',
  'action.playNext': 'Lire ensuite',
  'action.addToQueue': 'Ajouter à la file d’attente',

  'time.justNow': 'À l’instant',
  'time.minutesAgo':
    '{count, plural, one {il y a # minute} other {il y a # minutes}}',
  'time.hoursAgo':
    '{count, plural, one {il y a # heure} other {il y a # heures}}',
  'time.daysAgo': '{count, plural, one {il y a # jour} other {il y a # jours}}',
};

const pt: Complete<Table> = {
  'nav.home': 'Início',
  'nav.search': 'Pesquisar',
  'nav.library': 'Biblioteca',
  'nav.settings': 'Definições',

  'player.play': 'Reproduzir',
  'player.pause': 'Pausa',
  'player.next': 'Seguinte',
  'player.previous': 'Anterior',
  'player.shuffle': 'Aleatório',
  'player.repeat': 'Repetir',
  'player.queue': 'Fila',
  'player.live': 'Em direto',

  'library.tracks': '{count, plural, one {# faixa} other {# faixas}}',
  'library.albums': '{count, plural, one {# álbum} other {# álbuns}}',
  'library.empty': 'Ainda não há nada aqui.',

  'action.like': 'Gosto',
  'action.unlike': 'Remover dos favoritos',
  'action.download': 'Transferir',
  'action.addToPlaylist': 'Adicionar à playlist',
  'action.playNext': 'Reproduzir a seguir',
  'action.addToQueue': 'Adicionar à fila',

  'time.justNow': 'Agora mesmo',
  'time.minutesAgo': '{count, plural, one {há # minuto} other {há # minutos}}',
  'time.hoursAgo': '{count, plural, one {há # hora} other {há # horas}}',
  'time.daysAgo': '{count, plural, one {há # dia} other {há # dias}}',
};

const ja: Complete<Table> = {
  'nav.home': 'ホーム',
  'nav.search': '検索',
  'nav.library': 'ライブラリ',
  'nav.settings': '設定',

  'player.play': '再生',
  'player.pause': '一時停止',
  'player.next': '次へ',
  'player.previous': '前へ',
  'player.shuffle': 'シャッフル',
  'player.repeat': 'リピート',
  'player.queue': '再生キュー',
  'player.live': 'ライブ',

  // Japanese has no grammatical number. A single `other` branch is correct
  // here, not a shortcut — a singular form would be wrong.
  'library.tracks': '{count, plural, other {#曲}}',
  'library.albums': '{count, plural, other {#枚のアルバム}}',
  'library.empty': 'まだ何もありません。',

  'action.like': 'お気に入り',
  'action.unlike': 'お気に入りから削除',
  'action.download': 'ダウンロード',
  'action.addToPlaylist': 'プレイリストに追加',
  'action.playNext': '次に再生',
  'action.addToQueue': '再生キューに追加',

  'time.justNow': 'たった今',
  'time.minutesAgo': '{count, plural, other {#分前}}',
  'time.hoursAgo': '{count, plural, other {#時間前}}',
  'time.daysAgo': '{count, plural, other {#日前}}',
};

const ar: Complete<Table> = {
  'nav.home': 'الرئيسية',
  'nav.search': 'بحث',
  'nav.library': 'المكتبة',
  'nav.settings': 'الإعدادات',

  'player.play': 'تشغيل',
  'player.pause': 'إيقاف مؤقت',
  'player.next': 'التالي',
  'player.previous': 'السابق',
  'player.shuffle': 'عشوائي',
  'player.repeat': 'تكرار',
  'player.queue': 'قائمة التشغيل',
  'player.live': 'مباشر',

  // Arabic has six plural categories and all six are different words. Writing
  // only `one` and `other` would be wrong for 2, 3 and 11 — which are among
  // the commonest counts anybody sees.
  'library.tracks':
    '{count, plural, zero {لا مقاطع} one {مقطع واحد} two {مقطعان} few {# مقاطع} many {# مقطعًا} other {# مقطع}}',
  'library.albums':
    '{count, plural, zero {لا ألبومات} one {ألبوم واحد} two {ألبومان} few {# ألبومات} many {# ألبومًا} other {# ألبوم}}',
  'library.empty': 'لا يوجد شيء هنا بعد.',

  'action.like': 'إعجاب',
  'action.unlike': 'إزالة من المفضلة',
  'action.download': 'تنزيل',
  'action.addToPlaylist': 'إضافة إلى قائمة التشغيل',
  'action.playNext': 'تشغيل التالي',
  'action.addToQueue': 'إضافة إلى قائمة الانتظار',

  'time.justNow': 'الآن',
  'time.minutesAgo':
    '{count, plural, zero {الآن} one {قبل دقيقة} two {قبل دقيقتين} few {قبل # دقائق} many {قبل # دقيقة} other {قبل # دقيقة}}',
  'time.hoursAgo':
    '{count, plural, zero {الآن} one {قبل ساعة} two {قبل ساعتين} few {قبل # ساعات} many {قبل # ساعة} other {قبل # ساعة}}',
  'time.daysAgo':
    '{count, plural, zero {اليوم} one {قبل يوم} two {قبل يومين} few {قبل # أيام} many {قبل # يومًا} other {قبل # يوم}}',
};

const he: Complete<Table> = {
  'nav.home': 'בית',
  'nav.search': 'חיפוש',
  'nav.library': 'ספרייה',
  'nav.settings': 'הגדרות',

  'player.play': 'נגן',
  'player.pause': 'השהה',
  'player.next': 'הבא',
  'player.previous': 'הקודם',
  'player.shuffle': 'ערבוב',
  'player.repeat': 'חזרה',
  'player.queue': 'תור',
  'player.live': 'שידור חי',

  // Hebrew distinguishes one, two and other.
  'library.tracks':
    '{count, plural, one {רצועה אחת} two {שתי רצועות} other {# רצועות}}',
  'library.albums':
    '{count, plural, one {אלבום אחד} two {שני אלבומים} other {# אלבומים}}',
  'library.empty': 'אין כאן עדיין כלום.',

  'action.like': 'אהבתי',
  'action.unlike': 'הסר מהאהובים',
  'action.download': 'הורדה',
  'action.addToPlaylist': 'הוסף לפלייליסט',
  'action.playNext': 'נגן אחרי זה',
  'action.addToQueue': 'הוסף לתור',

  'time.justNow': 'הרגע',
  'time.minutesAgo':
    '{count, plural, one {לפני דקה} two {לפני שתי דקות} other {לפני # דקות}}',
  'time.hoursAgo':
    '{count, plural, one {לפני שעה} two {לפני שעתיים} other {לפני # שעות}}',
  'time.daysAgo':
    '{count, plural, one {אתמול} two {לפני יומיים} other {לפני # ימים}}',
};

/** Every table but English, which is the source of truth in `i18n.ts`. */
export const TRANSLATIONS: Record<string, Table> = {
  ar,
  de,
  es,
  fr,
  he,
  ja,
  pt,
};
