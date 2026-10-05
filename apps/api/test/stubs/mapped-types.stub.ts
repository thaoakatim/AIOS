/**
 * Stub CJS cho `@nestjs/mapped-types`.
 *
 * Lý do tồn tại: giống `@nestjs/config` v12, package này ở bản 12 chỉ phát
 * hành bản ESM (`"type": "module"`). Runtime NestJS chạy được nhờ Node
 * `require(ESM)`, còn Jest dùng CommonJS runtime riêng và sẽ ném lỗi
 * "Must use import to load ES Module" cho mọi spec import DTO dùng
 * `PartialType`.
 *
 * Cài đặt lại đúng logic gốc của thư viện: mixin tạo class mới copy toàn bộ
 * property của class gốc, rồi áp bộ lọc property theo yêu cầu.
 * `class-validator`/`class-transformer` không có trong dependencies nên DTO
 * của dự án chỉ mang metadata kiểu, không dùng decorator validate — stub
 * vì vậy không cần chạm vào validation pipe.
 */
import { Type } from '@nestjs/common';

type Class<T> = Type<T>;

function applyPropertyFilter<T>(
  classRef: Class<T>,
  propertyFilter: (key: string, value: unknown) => boolean,
): Class<Record<string, unknown>> {
  class MixedType {
    constructor() {
      const instance = new classRef() as unknown as Record<string, unknown>;
      for (const key of Object.getOwnPropertyNames(instance)) {
        if (propertyFilter(key, instance[key])) {
          (this as Record<string, unknown>)[key] = instance[key];
        }
      }
    }
  }
  return MixedType as Class<Record<string, unknown>>;
}

export function PartialType<T>(classRef: Class<T>): Class<Partial<T>> {
  return applyPropertyFilter(classRef, () => true) as Class<Partial<T>>;
}

export function PickType<T, K extends keyof T>(
  classRef: Class<T>,
  keys: readonly K[],
): Class<Pick<T, (typeof keys)[number]>> {
  const allowed = new Set<string>(keys as readonly string[]);
  return applyPropertyFilter(classRef, (key) => allowed.has(key)) as Class<
    Pick<T, (typeof keys)[number]>
  >;
}

export function OmitType<T, K extends keyof T>(
  classRef: Class<T>,
  keys: readonly K[],
): Class<Omit<T, (typeof keys)[number]>> {
  const omitted = new Set<string>(keys as readonly string[]);
  return applyPropertyFilter(classRef, (key) => !omitted.has(key)) as Class<
    Omit<T, (typeof keys)[number]>
  >;
}

export function IntersectionType<A, B>(
  classARef: Class<A>,
  classBRef: Class<B>,
): Class<A & B> {
  class IntersectionClassType {
    constructor() {
      Object.assign(this, new classARef() as object, new classBRef() as object);
    }
  }
  return IntersectionClassType as Class<A & B>;
}
