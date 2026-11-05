declare module "json-logic-js" {
  type JsonLogic = {
    apply(logic: unknown, data?: unknown): unknown;
  };
  const jsonLogic: JsonLogic;
  export default jsonLogic;
}
