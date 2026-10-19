import 'reflect-metadata'
function Inj(_t: any) {}
class Dep {}
class Svc { constructor(public d: Dep) {} }
Reflect.defineMetadata('design:paramtypes', [Dep], Svc)
console.log(Reflect.getMetadata('design:paramtypes', Svc)[0].name)
