import multer from "multer";
import path from "path";
import fs from "fs";
import { HttpError } from "../utils/http-error.js";

export const AVATAR_UPLOAD_DIR = path.join(process.cwd(), "uploads", "avatars");

// Garante que o diretório existe
fs.mkdirSync(AVATAR_UPLOAD_DIR, { recursive: true });

// Extensão derivada do mimetype validado, nunca do nome enviado pelo cliente.
export const AVATAR_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png":  ".png",
  "image/webp": ".webp",
};

const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  if (file.mimetype in AVATAR_EXTENSIONS) {
    cb(null, true);
  } else {
    cb(new HttpError(400, "Formato inválido. Use JPG, PNG ou WEBP."));
  }
};

// memoryStorage: o arquivo fica só em buffer até o controller validar a permissão.
// Com diskStorage o multer gravava em disco antes da checagem de autorização,
// permitindo que qualquer usuário autenticado sobrescrevesse o avatar de outro.
export const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter,
});
