import 'reflect-metadata'
import { Module, Controller, Get, Injectable } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

@Injectable()
class Svc { hello() { return { msg: 'from-nest-12' } } }

@Controller('api/ping')
class Ctl {
  constructor(private readonly svc: Svc) {}
  @Get() get() { return this.svc.hello() }
}

@Module({ controllers: [Ctl], providers: [Svc] })
class AppModule {}

const app = await NestFactory.create(AppModule, { logger: false })
await app.listen(0)
const url = await app.getUrl()
const res = await fetch(url + '/api/ping')
console.log('STATUS', res.status, 'BODY', JSON.stringify(await res.json()))
await app.close()
