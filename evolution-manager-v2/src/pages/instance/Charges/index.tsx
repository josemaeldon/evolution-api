import { SicoobSettings } from "@/components/sicoob-settings";
import { useInstance } from "@/contexts/InstanceContext";

export function Charges() {
  const { instance } = useInstance();

  return <div className="mx-auto w-full max-w-5xl">{instance?.name && <SicoobSettings instanceName={instance.name} />}</div>;
}
