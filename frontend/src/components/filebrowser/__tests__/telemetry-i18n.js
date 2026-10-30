// Use real interpolation and English resources for the telemetry contract tests.
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import filebrowser from '../../../i18n/locales/en/filebrowser.json';

await i18n.use(initReactI18next).init({
    lng: 'en', resources: {en: {filebrowser}}, interpolation: {escapeValue: false},
});
