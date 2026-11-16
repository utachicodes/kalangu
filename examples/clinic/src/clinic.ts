/**
 * The clinic agent: a fixed menu (answered in milliseconds), a question for
 * the nurse model (answered on screen if it is fast, by SMS if not), and a
 * language switch.
 */

import { ask, createAgent, menu, say, type AgentConfig, type Channel, type TurnContext } from "@kalangu/core";
import { fakeNurse, type NurseModel } from "./nurse.js";

type Ctx = TurnContext<NurseModel>;

export const start = menu({ en: "Clinic line", fr: "Ligne de la clinique" }, [
  {
    label: { en: "Opening hours", fr: "Horaires" },
    to: say({
      en: "Open Monday to Saturday, 8:00 to 18:00.",
      fr: "Ouvert du lundi au samedi, de 8 h à 18 h.",
    }),
  },
  {
    label: { en: "Ask a nurse", fr: "Question à une infirmière" },
    to: ask({ en: "Type your question", fr: "Tapez votre question" }, (question: string, ctx: Ctx) =>
      ctx.model.answer(question, ctx.locale),
    ),
  },
  {
    label: { en: "Language", fr: "Langue" },
    to: menu({ en: "Language", fr: "Langue" }, {
      English: (_input: string, ctx: Ctx) => {
        ctx.locale = "en";
      },
      Français: (_input: string, ctx: Ctx) => {
        ctx.locale = "fr";
      },
    }),
  },
]);

export interface ClinicOptions extends Partial<Omit<AgentConfig<NurseModel>, "start">> {
  channels: readonly Channel[];
}

export function createClinic(options: ClinicOptions) {
  return createAgent<NurseModel>({
    start,
    model: fakeNurse(),
    defaultLocale: "en",
    ...options,
  });
}
