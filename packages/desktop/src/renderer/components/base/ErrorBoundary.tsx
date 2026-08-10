import type { ReactNode } from 'react';
import React, { Component } from 'react';
import { Button, Result, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

class ErrorBoundaryClass extends Component<Props & { t: any }, State> {
  constructor(props: Props & { t: any }) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleTryAgain = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    const { hasError, error, errorInfo } = this.state;
    const { children, fallback, t } = this.props;

    if (hasError) {
      if (fallback) {
        return fallback;
      }

      return (
        <div className='flex w-full h-full items-center justify-center p-24px'>
          <Result
            status='error'
            title={t('error.boundary.title', { defaultValue: 'Something went wrong' })}
            subTitle={t('error.boundary.subtitle', {
              defaultValue: 'An unexpected error occurred while rendering this component.',
            })}
            extra={[
              <Button key='try-again' type='primary' onClick={this.handleTryAgain} className='mr-8px'>
                {t('error.boundary.tryAgain', { defaultValue: 'Try Again' })}
              </Button>,
              <Button key='reload' onClick={this.handleReload}>
                {t('error.boundary.reload', { defaultValue: 'Reload Page' })}
              </Button>,
            ]}
          >
            {process.env.NODE_ENV === 'development' && error && (
              <div className='mt-24px text-left p-16px bg-fill-2 rd-4px max-w-800px overflow-auto max-h-400px'>
                <Typography.Text type='error' bold>
                  {error.toString()}
                </Typography.Text>
                {errorInfo && (
                  <pre className='text-12px color-text-2 mt-8px whitespace-pre-wrap font-mono'>
                    {errorInfo.componentStack}
                  </pre>
                )}
              </div>
            )}
          </Result>
        </div>
      );
    }

    return children;
  }
}

export const ErrorBoundary: React.FC<Props> = (props) => {
  const { t } = useTranslation();
  return <ErrorBoundaryClass {...props} t={t} />;
};

export function withErrorBoundary<P extends object>(Component: React.ComponentType<P>, fallback?: ReactNode) {
  return function WithErrorBoundary(props: P) {
    return (
      <ErrorBoundary fallback={fallback}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}
