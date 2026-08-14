import { ReactNode } from "react";

import readerLoaderStyles from "./assets/styles/thorium-web.loader.module.css";

import { ThLoader } from "@/core/Components/Reader/ThLoader";

import { useI18n } from "@/i18n/useI18n";

export const StatefulLoader = ({ isLoading, children }: { isLoading: boolean, children: ReactNode }) => {
  const { t } = useI18n();

  return (
    <>
    <ThLoader 
      isLoading={ isLoading } 
      loader={ <div className={ readerLoaderStyles.loader }>{ t("reader.app.loading") }</div> } 
      className={ readerLoaderStyles.wrapper } 
    >
      { children }
    </ThLoader>
    </>
  )
}