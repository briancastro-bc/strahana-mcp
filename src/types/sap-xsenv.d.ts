declare module '@sap/xsenv' {
  export interface ServiceBinding {
    name: string;
    label?: string;
    tags?: string[];
    credentials: unknown;
  }
  /** Copies the keys of a default-env.json file into process.env (existing variables win). */
  export function loadEnv(jsonFile?: string): void;
  /** Filters VCAP_SERVICES bindings by name, tag or label. */
  export function filterServices(filter: {
    name?: string;
    tag?: string;
    label?: string;
  }): ServiceBinding[];
}
