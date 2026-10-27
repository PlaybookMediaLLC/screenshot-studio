import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

const messageLoaders = {
  en: () => import("../messages/en.json").then((module) => module.default),
  es: () => import("../messages/es.json").then((module) => module.default),
  fr: () => import("../messages/fr.json").then((module) => module.default),
  de: () => import("../messages/de.json").then((module) => module.default),
  ja: () => import("../messages/ja.json").then((module) => module.default),
  pt: () => import("../messages/pt.json").then((module) => module.default),
  ko: () => import("../messages/ko.json").then((module) => module.default),
  zh: () => import("../messages/zh.json").then((module) => module.default),
};

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: await messageLoaders[locale](),
  };
});
