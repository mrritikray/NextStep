/**
 * Upload validation + text extraction for resumes and job screenshots.
 *
 * Files are processed in memory only on the local server. Uploaded files are
 * never written to disk as executables and never executed.
 */
import mammoth from "mammoth";

export type UploadKind = "resume" | "image";

export type FileValidationError = {
  code: "too_large" | "bad_type" | "empty";
  message: string;
};

const RESUME_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/x-pdf",
  "application/octet-stream", // some browsers send this for .docx
];

const IMAGE_MIME = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

export const MAX_RESUME_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

export const RESUME_EXTENSIONS = [".pdf", ".docx", ".doc"];
export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index === -1 ? "" : fileName.slice(index).toLowerCase();
}

export function validateUpload(
  kind: UploadKind,
  fileName: string,
  mimeType: string,
  size: number,
): FileValidationError | null {
  if (!size) return { code: "empty", message: "The uploaded file is empty." };

  const extension = extensionOf(fileName);
  const allowedExtensions = kind === "resume" ? RESUME_EXTENSIONS : IMAGE_EXTENSIONS;
  const allowedMime = kind === "resume" ? RESUME_MIME : IMAGE_MIME;
  const limit = kind === "resume" ? MAX_RESUME_BYTES : MAX_IMAGE_BYTES;

  if (!allowedExtensions.includes(extension)) {
    return {
      code: "bad_type",
      message:
        kind === "resume"
          ? "Please upload a PDF or DOCX file."
          : "Please upload a JPG, JPEG, PNG, or WEBP image.",
    };
  }

  if (!allowedMime.includes(mimeType)) {
    return {
      code: "bad_type",
      message:
        kind === "resume"
          ? "Please upload a PDF or DOCX file."
          : "Please upload a JPG, JPEG, PNG, or WEBP image.",
    };
  }

  if (size > limit) {
    return {
      code: "too_large",
      message: `The file is too large. Maximum size is ${Math.round(limit / (1024 * 1024))} MB.`,
    };
  }

  return null;
}

/**
 * Extract plain text from a PDF buffer.
 * Supports both pdf-parse v1 (callable default) and v2 (PDFParse class).
 */
async function extractPdfText(buffer: Buffer): Promise<{ text: string; pages?: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import("pdf-parse");

  if (mod?.PDFParse) {
    const parser = new mod.PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return {
        text: normaliseText(String(result?.text ?? "")),
        pages: typeof result?.total === "number" ? result.total : undefined,
      };
    } finally {
      await parser.destroy?.().catch(() => undefined);
    }
  }

  const callable = mod?.default ?? mod;
  if (typeof callable === "function") {
    const parsed = await callable(buffer);
    return {
      text: normaliseText(String(parsed?.text ?? "")),
      pages: parsed?.numpages,
    };
  }

  throw new Error("No supported PDF parser was found.");
}

/** Extract plain text from a PDF or DOCX buffer. */
export async function extractResumeText(
  fileName: string,
  buffer: Buffer,
): Promise<{ text: string; pages?: number }> {
  const extension = extensionOf(fileName);

  if (extension === ".pdf") return extractPdfText(buffer);

  if (extension === ".docx" || extension === ".doc") {
    const result = await mammoth.extractRawText({ buffer });
    return { text: normaliseText(result.value ?? "") };
  }

  throw new Error("Unsupported resume format.");
}

function normaliseText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Convert a base64 payload to a Buffer. */
export function decodeBase64Payload(base64: string): Buffer {
  const cleaned = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  return Buffer.from(cleaned, "base64");
}
