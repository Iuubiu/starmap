function Dec(_t: any, _k: string) {}
class Foo { @Dec bar = 1 }
console.log(new Foo().bar)
