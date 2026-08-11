import { check } from 'express-validator';
import { validator } from '../../../kernel/index.js';

export const validateUpdate = [
    check('pushEnabled').optional({ nullable: true }).isBoolean(),
    check('pushToken').optional({ nullable: true }).isString(),
    check('quietHoursStart').optional({ nullable: true }).matches(/^\d{2}:\d{2}$/),
    check('quietHoursEnd').optional({ nullable: true }).matches(/^\d{2}:\d{2}$/),
    check('doNotDisturbEnabled').optional({ nullable: true }).isBoolean(),
    check('messageRetentionDays').optional({ nullable: true }).isInt({ min: 0, max: 365 }),
    check('dollarDefaultCasa').optional({ nullable: true }).isString(),
    check('euroDefaultCasa').optional({ nullable: true }).isString(),
    check('onboardingCompleted').optional({ nullable: true }).isBoolean(),
    check('onboardingStep').optional({ nullable: true }).isInt({ min: 0, max: 10 }),
    check('onboardingMeta').optional({ nullable: true }).custom((v) => v === null || typeof v === 'object'),
    (req, res, next) => validator(req, res, next)
];

export const validatePushToken = [
    check('token').exists().isString().isLength({ min: 10, max: 500 }),
    (req, res, next) => validator(req, res, next)
];
