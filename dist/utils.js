"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkLamports = void 0;
function checkLamports(provider, min, log) {
    return __awaiter(this, void 0, void 0, function* () {
        const lamports = (yield provider.connection.getAccountInfo(provider.wallet.publicKey)).lamports;
        if (lamports < min) {
            log.fatal({ err: "Insufficient lamports" });
            throw new Error("Insufficient lamports");
        }
    });
}
exports.checkLamports = checkLamports;
//# sourceMappingURL=utils.js.map