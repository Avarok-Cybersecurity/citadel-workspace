import { Meta, StoryFn } from '@storybook/react';
import { Fragment } from 'react';
import { Container } from './Container';
import { Row } from './Row';
import { Column } from './Column';

export default {
  title: 'Components / Grid',
} as Meta;

export const Grid: StoryFn = () => (
  <Fragment>
    <Container>
      <Row>
        <Column className="mb-3 sm:w-1/2">
          Lorem ipsum dolor sit amet, consectetur adipisicing elit. Aliquam
          aperiam asperiores consectetur consequatur delectus eos esse fugiat
          ipsum itaque labore minima mollitia nesciunt officiis pariatur
          provident tenetur, ut vel veniam.
        </Column>
        <Column className="mb-3 sm:w-1/2">
          Lorem ipsum dolor sit amet, consectetur adipisicing elit. Aliquam
          aperiam asperiores consectetur consequatur delectus eos esse fugiat
          ipsum itaque labore minima mollitia nesciunt officiis pariatur
          provident tenetur, ut vel veniam.
        </Column>
      </Row>
      <br />
      <Row>
        <Column className="mb-3 md:w-1/3">
          Lorem ipsum dolor sit amet, consectetur adipisicing elit. Aliquam
          aperiam asperiores consectetur consequatur delectus eos esse fugiat
          ipsum itaque labore minima mollitia nesciunt officiis pariatur
          provident tenetur, ut vel veniam.
        </Column>
        <Column className="mb-3 md:w-1/3">
          Lorem ipsum dolor sit amet, consectetur adipisicing elit. Aliquam
          aperiam asperiores consectetur consequatur delectus eos esse fugiat
          ipsum itaque labore minima mollitia nesciunt officiis pariatur
          provident tenetur, ut vel veniam.
        </Column>
        <Column className="mb-3 md:w-1/3">
          Lorem ipsum dolor sit amet, consectetur adipisicing elit. Aliquam
          aperiam asperiores consectetur consequatur delectus eos esse fugiat
          ipsum itaque labore minima mollitia nesciunt officiis pariatur
          provident tenetur, ut vel veniam.
        </Column>
      </Row>
    </Container>
    <Container>
      Lorem ipsum dolor sit amet, consectetur adipisicing elit. A illo odit
      praesentium sequi similique. Architecto consectetur cupiditate dolore
      dolorem eveniet fugiat illum magni maxime minus natus obcaecati quasi
      quibusdam, quo reprehenderit repudiandae sapiente, sed soluta tempora
      velit voluptas? Adipisci aliquid architecto commodi consequatur
      consequuntur deleniti dicta eos est facere fuga inventore ipsa ipsum iusto
      molestiae necessitatibus odio officiis porro, quaerat reiciendis sed sequi
      tenetur velit. Accusantium amet, dolor ducimus eius facere possimus
      recusandae suscipit! Commodi cum delectus deleniti dolorem eius, eum
      fugiat impedit laborum molestiae, nostrum pariatur perferendis praesentium
      quasi quidem quod repudiandae sit tempore totam ullam veniam? Consectetur,
      natus!
    </Container>
  </Fragment>
);
