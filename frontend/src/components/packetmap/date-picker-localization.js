/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import moment from 'moment-timezone';
import localeMoment from 'moment/moment.js';
import 'moment/locale/en-gb';
import 'moment/locale/el';
import 'moment/locale/de';
import 'moment/locale/fr';
import 'moment/locale/es';
import 'moment/locale/it';
import 'moment/locale/nl';
import 'moment/locale/pt';
import 'moment/locale/ru';
import 'moment/locale/ja';
import 'moment/locale/zh-cn';

// Browser bundling can give the locale modules a separate Moment registry.
// Register their complete definitions on the timezone instance used by the picker.
for (const name of ['en-gb', 'el', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'ru', 'ja', 'zh-cn']) {
    if (!moment.locales().includes(name)) moment.defineLocale(name, localeMoment.localeData(name)._config);
}
// Register the locales offered in Preferences without changing Moment's
// existing English default for the rest of the application.
moment.locale('en');
localeMoment.locale('en');

export function datePickerLocalization(locale) {
    // Native datetime-local fields ignore the application's locale. Derive
    // the editable picker's tokens from Intl, as with the other date displays.
    // This also respects Browser Default, including regional date ordering.
    const formatter = new Intl.DateTimeFormat(locale, {timeZone: 'UTC', year: 'numeric', month: '2-digit',
        day: '2-digit', hour: '2-digit', minute: '2-digit'});
    const {locale: resolvedLocale, hour12} = formatter.resolvedOptions();
    const tokens = {year: 'YYYY', month: 'MM', day: 'DD', hour: hour12 ? 'hh' : 'HH', minute: 'mm', dayPeriod: 'A'};
    const format = formatter.formatToParts(new Date(Date.UTC(2026, 10, 23, 17, 6)))
        .map(({type, value}) => tokens[type] || `[${value.replace(/[\u00a0\u202f]/g, ' ')}]`).join('');
    return {format, ampm: hour12, adapterLocale: moment().locale(resolvedLocale.toLowerCase()).locale()};
}
