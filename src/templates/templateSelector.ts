import { buildPostHtml as buildTemplateA, type PostTemplateData } from "./postTemplate";
import { buildPostHtml as buildTemplateD } from "./templateD";

export type TemplateId = "templateA" | "templateD";

export function buildHtml(templateId: TemplateId, data: PostTemplateData): string {
  switch (templateId) {
    case "templateA":
      return buildTemplateA(data);
    case "templateD":
    default:
      return buildTemplateD(data);
  }
}

export const DEFAULT_TEMPLATE: TemplateId = "templateD";
