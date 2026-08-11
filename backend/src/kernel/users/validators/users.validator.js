import { check } from "express-validator";
import { validator } from "../../../middlewares/validator.js";

export const  validateId = [
  check("id").exists().isInt(),
  (req, res, next) => {
    validator(req, res, next);
  },
];

export const  validateCreateUpdate = [
  check("name").optional({ nullable: true }).isString(),
  check("lastName").optional({ nullable: true }).isString(),
  check("email").optional({ nullable: true }).isString(),
  check("username").exists().notEmpty().isString(),
  check("password").optional({ nullable: true }).isString(),
  check("phone").optional({ nullable: true }).isString(),
  check("avatar").optional({ nullable: true }).isString(),
  check("avatarColor").optional({ nullable: true }).isString(),
  check("active").optional({ nullable: true }),
  check("roleId").exists().isInt(),
  (req, res, next) => {
    validator(req, res, next);
  },
];

export const  validateQuery = [
  check("name").optional({ nullable: true }).isString(),
  check("username").optional({ nullable: true }).isString(),
  check("roles").optional({ nullable: true }).isString(),
  check("roleLabels").optional({ nullable: true }).isString(),
  check("limit").optional({ nullable: true }).isNumeric(),
  check("page").optional({ nullable: true }).isNumeric(),
  check("order").optional({ nullable: true }).isString(),
  check("order_type").optional({ nullable: true }).isString(),
  (req, res, next) => {
    validator(req, res, next);
  },
];

export const validateMyAccount = [
  check("name").optional({ nullable: true }).isString().trim().notEmpty(),
  check("lastName").optional({ nullable: true }).isString().trim().notEmpty(),
  check("email").optional({ nullable: true }).isEmail().withMessage("El email no es válido"),
  check("avatar").optional({ nullable: true }).isString(),
  check("avatarColor").optional({ nullable: true }).isString(),
  // Vacía = no cambiar; si viene, mínimo 8 (regla del PRD).
  check("password").optional({ nullable: true, checkFalsy: true }).isString().isLength({ min: 8 })
    .withMessage("La nueva contraseña debe tener al menos 8 caracteres"),
  (req, res, next) => {
    validator(req, res, next);
  },
];
