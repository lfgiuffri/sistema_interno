import { check } from "express-validator";
import { validator } from "../../../middlewares/validator.js";

export const validateSignIn = [
  check("username").exists().notEmpty().isString(),
  check("password").exists().notEmpty().isString(),
  (req, res, next) => {
    validator(req, res, next);
  },
];

export const validateChangePassword = [
  check("currentPassword").exists().notEmpty().isString(),
  // Mínimo 8 caracteres (decisión del PRD; el legado pedía 6).
  check("newPassword").exists().isString().isLength({ min: 8 })
    .withMessage("La nueva contraseña debe tener al menos 8 caracteres"),
  (req, res, next) => {
    validator(req, res, next);
  },
];
