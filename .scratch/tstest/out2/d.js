"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
function Inj(_t) { }
class Dep {
}
class Svc {
    d;
    constructor(d) {
        this.d = d;
    }
}
Reflect.defineMetadata('design:paramtypes', [Dep], Svc);
console.log(Reflect.getMetadata('design:paramtypes', Svc)[0].name);
