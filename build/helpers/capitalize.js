"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.capitalize = capitalize;
/**
 * Capitalize a string: first character uppercase, the rest lowercase.
 * @param {string} s
 * @returns {string}
 */
function capitalize(s) {
    if (typeof s !== 'string' || s.length === 0)
        return s;
    return s[0].toUpperCase() + s.slice(1).toLowerCase();
}
